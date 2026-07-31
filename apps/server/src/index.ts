import { createContext } from "@DashboardV2/api/context";
import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import { appRouter } from "@DashboardV2/api/routers/index";
import { auth } from "@DashboardV2/auth";
import { resolveCompanyIdForSession } from "@DashboardV2/api/lib/scope";
import { db } from "@DashboardV2/db";
import { notePhoto, project, projectMember, projectNote } from "@DashboardV2/db/schema";
import { trustedOrigins } from "@DashboardV2/env/server";
import { trpcServer } from "@hono/trpc-server";
import { and, eq, exists, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    // A list, not one value: on a preview the browser may be on either the
    // per-build or the per-branch hostname (packages/env/src/server.ts).
    origin: trustedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    // The spreadsheet export reads its filename off this header. Without it
    // listed, the browser hides the header from cross-origin JS — which is
    // every request in development, where the web app is on another port — and
    // every download silently falls back to the generic name. Production goes
    // through the /api rewrite and is same-origin, so this only ever broke on
    // the machine of whoever was writing the feature.
    exposeHeaders: ["Content-Disposition"],
    credentials: true,
  }),
);

/**
 * The admin plugin's raw HTTP surface is cross-tenant by construction (it
 * knows nothing of companyId). Every in-app user-management flow goes through
 * tRPC instead, which scopes per-tenant before calling auth.api.* server-side
 * — and a server-side auth.api.* call never passes back through this Hono
 * middleware. So nothing legitimate reaches this path except a super admin
 * poking the raw API directly; everyone else gets a 404, same as a
 * cross-tenant id anywhere else in this app.
 */
app.use("/api/auth/admin/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (roleOf(session?.user ?? {}) !== "super_admin") {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * The browser compresses photos to ~1 MB before sending, so this cap is a
 * safety net, not the working limit. It must stay under Vercel's hard 4.5 MB
 * serverless request-body ceiling — anything bigger never reaches this code
 * in production, so accepting it locally would only mask a deploy-time bug.
 */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Resolves the caller's company for these plain Hono routes.
 *
 * resolveCompanyIdForSession is shared with tRPC and signals failure by
 * throwing a TRPCError, which only the tRPC pipeline knows how to turn into a
 * status. Here it would escape as an unhandled 500 with no body — so an account
 * that has no company assigned would see every photo <img> break with a generic
 * error instead of the sentence explaining what is wrong. Map it instead.
 */
async function resolveCompany(sessionUser: Parameters<typeof resolveCompanyIdForSession>[0], headers: Headers) {
  try {
    return { companyId: await resolveCompanyIdForSession(sessionUser, headers) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : "No company assigned";
    return { error: message, status: code === "FORBIDDEN" ? (403 as const) : (409 as const) };
  }
}

/**
 * Stores a note photo as bytes in Postgres. Reached from the browser as
 * /api/notes/:noteId/photos: vercel.json strips the /api prefix for everything
 * except /api/auth. Raw image body, not multipart — one file per request keeps
 * both the route and the client's per-file error handling trivial.
 */
app.post("/notes/:noteId/photos", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!PHOTO_CONTENT_TYPES.has(contentType)) {
    return c.json({ error: `Unsupported image type: ${contentType || "unknown"}` }, 415);
  }

  // Reject on the declared length before buffering the body into memory.
  const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
    return c.json({ error: "Photo exceeds the 4 MB upload limit" }, 413);
  }

  // Same company (and, for role=user, project-membership) rule as tRPC — a
  // note in another tenant, or in a project this account isn't assigned to,
  // must read as absent.
  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status);
  }
  const { companyId } = scope;
  const noteId = c.req.param("noteId");
  const [note] = await db
    .select({ id: projectNote.id })
    .from(projectNote)
    .innerJoin(project, eq(projectNote.projectId, project.id))
    .where(
      and(
        eq(projectNote.id, noteId),
        eq(project.companyId, companyId),
        roleOf(session.user) === "user"
          ? exists(
              db
                .select({ one: sql`1` })
                .from(projectMember)
                .where(
                  and(
                    eq(projectMember.projectId, project.id),
                    eq(projectMember.userId, session.user.id),
                  ),
                ),
            )
          : undefined,
      ),
    );
  if (!note) {
    return c.json({ error: "Note not found" }, 404);
  }

  const body = Buffer.from(await c.req.arrayBuffer());
  if (body.byteLength === 0) {
    return c.json({ error: "Empty upload" }, 400);
  }
  if (body.byteLength > MAX_PHOTO_BYTES) {
    return c.json({ error: "Photo exceeds the 4 MB upload limit" }, 413);
  }

  const [created] = await db
    .insert(notePhoto)
    .values({ noteId, data: body, contentType, size: body.byteLength })
    .returning({ id: notePhoto.id });
  if (!created) {
    return c.json({ error: "Could not save the photo" }, 500);
  }

  return c.json({ id: created.id });
});

/**
 * Serves photo bytes back out of Postgres.
 *
 * Guarded by session *and* company: a bare id would otherwise be enough for one
 * tenant to read another's site evidence. Joining through to project is what
 * enforces that — note_photo carries no company of its own.
 *
 * The immutable cache header is safe because rows are insert-only (a photo's
 * bytes never change under its id) and `private` keeps it out of shared caches,
 * which matters now that the response is per-viewer authorised.
 */
app.get("/photos/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status);
  }
  const { companyId } = scope;

  const [photo] = await db
    .select({ data: notePhoto.data, contentType: notePhoto.contentType })
    .from(notePhoto)
    .innerJoin(projectNote, eq(notePhoto.noteId, projectNote.id))
    .innerJoin(project, eq(projectNote.projectId, project.id))
    .where(
      and(
        eq(notePhoto.id, c.req.param("id")),
        eq(project.companyId, companyId),
        roleOf(session.user) === "user"
          ? exists(
              db
                .select({ one: sql`1` })
                .from(projectMember)
                .where(
                  and(
                    eq(projectMember.projectId, project.id),
                    eq(projectMember.userId, session.user.id),
                  ),
                ),
            )
          : undefined,
      ),
    );
  if (!photo) {
    return c.json({ error: "Photo not found" }, 404);
  }

  return c.body(new Uint8Array(photo.data), 200, {
    "Content-Type": photo.contentType,
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

/**
 * The project list as a spreadsheet.
 *
 * A plain Hono route rather than a tRPC procedure because the response is a
 * binary file, and tRPC's JSON envelope would mean base64 in and out of a string
 * — the same reason the note photos above are not tRPC either.
 *
 * Deliberately the whole company portfolio, not the caller's current filters:
 * exporting is what people do to work on the numbers elsewhere, and a file that
 * silently held 3 of 200 projects because a filter was set is the kind of thing
 * nobody notices until it is in a report. `projectAccessFilter` still applies,
 * so a role=user only ever gets the projects they are a member of.
 */
app.get("/projects/export", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!hasPermission(roleOf(session.user), "project:read")) {
    return c.json({ error: "Not found" }, 404);
  }

  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) {
    return c.json({ error: scope.error }, scope.status);
  }

  // Imported here, not at the top of the file.
  //
  // project-export pulls in exceljs, which is CommonJS over a large tree of
  // dynamic requires that Vercel's bundler does not resolve the way Bun does
  // locally. Making the *exceljs* import lazy was not enough: this module was
  // still imported eagerly, so exceljs stayed in the boot graph and the whole
  // Hono app died at cold start with an empty `ResolveMessage {}` — every
  // route 500ing, sign-in included, while the web service was fine and local
  // dev was fine. That is what took production down between V2.10 and V2.11.
  //
  // Keeping the whole module behind this await means a failure to resolve it
  // can only ever cost the spreadsheet download, never the ability to sign in.
  const { buildProjectWorkbook } = await import("./project-export");

  const { filename, body } = await buildProjectWorkbook({
    companyId: scope.companyId,
    session: { user: session.user },
    locale: c.req.query("locale") === "id" ? "id" : "en",
  });

  return c.body(body, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    // Generated per request from live data; a cached copy is always wrong.
    "Cache-Control": "no-store",
  });
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
