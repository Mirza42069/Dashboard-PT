import { createContext } from "@DashboardV2/api/context";
import {
  interpolate,
  localeFromHeaders,
  type MessageDictionary,
  tFor,
} from "@DashboardV2/api/lib/messages/index";
import { recordActivity } from "@DashboardV2/api/lib/activity";
import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import { appRouter } from "@DashboardV2/api/routers/index";
import {
  auth,
  PASSWORD_SETUP_HASH_HEADER,
  verifyPasswordSetupToken,
} from "@DashboardV2/auth";
import { projectAccessFilter, resolveCompanyIdForSession } from "@DashboardV2/api/lib/scope";
import { MAX_AI_WORKBOOK_BYTES } from "@DashboardV2/api/lib/workbook-limits";
import { TRIAL_AI_EXHAUSTED, trialHasEnded } from "@DashboardV2/api/lib/trial";
import { db } from "@DashboardV2/db";
import {
  notePhoto,
  type PeriodType,
  project,
  projectActualCurve,
  projectMember,
  projectNote,
  reportingPeriod,
  user,
  workbookRequestLimit,
} from "@DashboardV2/db/schema";
import { env, trustedOrigins } from "@DashboardV2/env/server";
import { trpcServer } from "@hono/trpc-server";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { and, asc, eq, exists, sql } from "drizzle-orm";
import { Hono, type Context as HonoRequestContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { stream } from "hono/streaming";

import {
  decodeWorkbookTransport,
  WORKBOOK_TRANSPORT_CONTENT_TYPE,
  WorkbookTransportError,
} from "./workbook-transport";
import {
  assertTemporaryWorkbookPath,
  consumeTemporaryWorkbook,
  discardTemporaryWorkbook,
  purgeExpiredTemporaryWorkbooks,
  TemporaryWorkbookError,
  XLSX_CONTENT_TYPE,
} from "./temporary-workbook";

/**
 * Mirrors MAX_IMPORT_BYTES in ./boq-import, which cannot be imported here — that
 * module pulls exceljs, and naming any of its exports at the top level puts
 * exceljs back in the boot graph. See the note on the lazy imports below.
 */
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** Mirrors NDJSON_CONTENT_TYPE in apps/web/src/app/(app)/projects/project-workbook-import-dialog.tsx. */
const NDJSON_CONTENT_TYPE = "application/x-ndjson";

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
  if (roleOf(session?.user ?? {}) !== "super_admin" || session?.user.mustChangePassword) {
    return c.json({ error: "Not found" }, 404);
  }
  await next();
});
// In-app profile administration goes through tenant-scoped tRPC procedures.
// Closing the generic raw update route also keeps usernames immutable.
app.use("/api/auth/admin/update-user", async (c) => c.json({ error: "Not found" }, 404));

// Password setup emails are admin-issued. Keeping this raw endpoint closed
// prevents unauthenticated visitors from using it to send account email.
app.use("/api/auth/request-password-reset", async (c) => c.json({ error: "Not found" }, 404));
// The in-app account procedure owns current-password verification, password
// policy, session revocation, and clearing the forced-change flag as one flow.
app.use("/api/auth/change-password", async (c) => c.json({ error: "Not found" }, 404));
// Usernames are immutable administrator-issued credentials. Better Auth's
// username plugin otherwise exposes them through the generic update-user route.
app.use("/api/auth/update-user", async (c) => c.json({ error: "Not found" }, 404));

app.post("/api/auth/reset-password", async (c) => {
  let token: string | undefined;
  try {
    const body = (await c.req.raw.clone().json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : undefined;
  } catch {
    return c.json({ error: "Invalid password setup request" }, 400);
  }
  if (!token) token = new URL(c.req.url).searchParams.get("token") ?? undefined;
  const tokenHash = token ? await verifyPasswordSetupToken(token) : null;
  if (!tokenHash) return c.json({ error: "Invalid or expired password setup link" }, 400);

  const headers = new Headers(c.req.raw.headers);
  headers.set(PASSWORD_SETUP_HASH_HEADER, tokenHash);
  return auth.handler(new Request(c.req.raw, { headers }));
});

app.use("/api/auth/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user.mustChangePassword) {
    await next();
    return;
  }
  const path = c.req.path;
  if (
    path === "/api/auth/get-session" ||
    path === "/api/auth/sign-out" ||
    path === "/api/auth/reset-password" ||
    path.startsWith("/api/auth/reset-password/")
  ) {
    await next();
    return;
  }
  return c.json({ error: "Password setup required" }, 403);
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
 * The session, or null — plus the one check better-auth cannot make for us.
 *
 * A trial that lapsed mid-session still holds a valid cookie: packages/auth
 * refuses to *create* a session for an ended trial, not to honour one already
 * open. These routes share no middleware, so every one of them asks here.
 *
 * An ended trial reads as "not signed in" rather than as its own status, which
 * keeps each call site's existing 401 branch correct and adds no new failure
 * mode to handle. The person is told what actually happened when they next try
 * to sign in, which is where the message belongs.
 */
async function activeSession(c: HonoRequestContext) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return null;
  return trialHasEnded(session.user) || session.user.mustChangePassword ? null : session;
}

/**
 * Resolves the caller's company for these plain Hono routes.
 *
 * resolveCompanyIdForSession is shared with tRPC and signals failure by
 * throwing a TRPCError, which only the tRPC pipeline knows how to turn into a
 * status. Here it would escape as an unhandled 500 with no body — so an account
 * that has no company assigned would see every photo <img> break with a generic
 * error instead of the sentence explaining what is wrong. Map it instead.
 */
type CompanyResolution =
  | { companyId: string }
  | { error: string; status: 403 | 409 };

async function resolveCompany(
  sessionUser: Parameters<typeof resolveCompanyIdForSession>[0],
  headers: Headers,
): Promise<CompanyResolution> {
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
  const session = await activeSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!PHOTO_CONTENT_TYPES.has(contentType)) {
    const t = tFor(c.req.raw.headers);
    return c.json(
      {
        error: interpolate(t.upload.unsupportedImageType, {
          type: contentType || t.upload.unknownImageType,
        }),
      },
      415,
    );
  }

  // Reject on the declared length before buffering the body into memory.
  const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
    return c.json({ error: tFor(c.req.raw.headers).upload.photoTooLarge }, 413);
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
    .select({ id: projectNote.id, archivedAt: project.archivedAt })
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
    return c.json({ error: tFor(c.req.raw.headers).note.notFound }, 404);
  }
  if (note.archivedAt !== null) {
    return c.json({ error: tFor(c.req.raw.headers).archived.project }, 409);
  }

  const body = Buffer.from(await c.req.arrayBuffer());
  if (body.byteLength === 0) {
    return c.json({ error: tFor(c.req.raw.headers).upload.empty }, 400);
  }
  if (body.byteLength > MAX_PHOTO_BYTES) {
    return c.json({ error: tFor(c.req.raw.headers).upload.photoTooLarge }, 413);
  }

  const photoId = crypto.randomUUID();
  const created = await db.execute<{ id: string }>(sql`
    insert into "note_photo" ("id", "note_id", "data", "content_type", "size")
    select ${photoId}, note."id", ${body}, ${contentType}, ${body.byteLength}
    from "project_note" as note
    inner join "project" as parent on parent."id" = note."project_id"
    where note."id" = ${noteId} and parent."archived_at" is null
    returning "id"
  `);
  if (created.rows.length === 0) {
    return c.json({ error: tFor(c.req.raw.headers).project.changedRefresh }, 409);
  }

  return c.json({ id: photoId });
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
  const session = await activeSession(c);
  if (!session) {
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
  const session = await activeSession(c);
  if (!session) {
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
    // An explicit query param wins — the download URL carries its own
    // choice — but the request's own locale is a better default than
    // assuming English.
    locale: c.req.query("locale") === "id" ? "id" : localeFromHeaders(c.req.raw.headers),
  });

  return c.body(body, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    // Generated per request from live data; a cached copy is always wrong.
    "Cache-Control": "no-store",
  });
});

/**
 * Building a BoQ from a spreadsheet: preview, commit, and the error report.
 *
 * Plain Hono rather than tRPC for the same reason as the photo upload and the
 * export — the request body is a binary file, which tRPC's JSON envelope would
 * turn into base64 in both directions.
 *
 * Access is decided by re-running `projectAccessFilter` as part of the lookup
 * rather than by checking the company after fetching. That filter is the same
 * one the project list and the portfolio export use, so these routes cannot
 * drift from them, and it carries the project_member rule for role=user for
 * free. A project outside the caller's scope returns no row and the 404 is
 * indistinguishable from one that does not exist — the rule lib/scope.ts sets
 * out, since FORBIDDEN would confirm another tenant's project to whoever asked.
 *
 * assertProjectAccess would have been the obvious call and is the wrong one: it
 * signals by throwing TRPCError, which outside the tRPC pipeline escapes as a
 * bare 500.
 */
type ProjectWriteAccess =
  | { error: string; status: 401 | 403 | 404 | 409 }
  | {
      session: AuthSession;
      companyId: string;
      project: {
        code: string;
        name: string;
        client: string | null;
        location: string | null;
        startDate: string | null;
        scheduleStart: string | null;
        endDate: string | null;
        periodType: PeriodType;
        periodLengthDays: number | null;
        updatedAt: Date;
        archivedAt: Date | null;
      };
    };

async function requireProjectAccess(
  c: HonoRequestContext,
  projectId: string,
): Promise<ProjectWriteAccess> {
  const session = await activeSession(c);
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (!hasPermission(roleOf(session.user), "project:write")) {
    return { error: "Not found", status: 404 as const };
  }

  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) return { error: scope.error, status: scope.status };

  const [visible] = await db
    .select({
      code: project.code,
      name: project.name,
      client: project.client,
      location: project.location,
      startDate: project.startDate,
      scheduleStart: project.scheduleStart,
      endDate: project.endDate,
      periodType: project.periodType,
      periodLengthDays: project.periodLengthDays,
      updatedAt: project.updatedAt,
      archivedAt: project.archivedAt,
    })
    .from(project)
    .where(
      and(
        eq(project.id, projectId),
        projectAccessFilter({ companyId: scope.companyId, session: { user: session.user } }),
      ),
    );
  if (!visible) return { error: "Not found", status: 404 as const };
  return { session, companyId: scope.companyId, project: visible };
}

async function requireProjectWrite(
  c: HonoRequestContext,
  projectId: string,
): Promise<ProjectWriteAccess> {
  const access = await requireProjectAccess(c, projectId);
  if ("error" in access || access.project.archivedAt === null) return access;
  return { error: tFor(c.req.raw.headers).archived.project, status: 409 as const };
}

/** Reads the uploaded workbook, refusing anything past the body limit. */
function readUpload(
  t: MessageDictionary,
  bytes: Uint8Array,
): { bytes: Uint8Array } | { error: string; status: 400 | 413 } {
  if (bytes.byteLength === 0) return { error: t.upload.empty, status: 400 as const };
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { error: t.upload.workbookTooLarge, status: 413 as const };
  }
  return { bytes };
}

async function readWorkbookRequest(c: HonoRequestContext) {
  if ((c.req.header("content-type") ?? "").startsWith("application/json")) {
    try {
      const parsed = workbookUpdateBody(await c.req.json());
      const session = await activeSession(c);
      if (!session) return { error: "Unauthorized", status: 400 as const };
      return await consumeTemporaryWorkbook({
        pathname: parsed.pathname,
        projectId: `project-import/${session.user.id}`,
        run: async ({ bytes }) => ({ bytes, fields: parsed.body, filename: parsed.filename }),
      });
    } catch (error) {
      if (error instanceof TemporaryWorkbookError) {
        return { error: error.message, status: 400 as const };
      }
      throw error;
    }
  }

  if ((c.req.header("content-type") ?? "").startsWith(WORKBOOK_TRANSPORT_CONTENT_TYPE)) {
    try {
      const decoded = decodeWorkbookTransport(new Uint8Array(await c.req.arrayBuffer()));
      const upload = readUpload(tFor(c.req.raw.headers), decoded.bytes);
      if ("error" in upload) return upload;
      return {
        bytes: upload.bytes,
        fields: decoded.metadata,
        filename:
          typeof decoded.metadata.filename === "string"
            ? decoded.metadata.filename
            : "workbook.xlsx",
      };
    } catch (error) {
      if (error instanceof WorkbookTransportError) {
        return { error: error.message, status: 400 as const };
      }
      throw error;
    }
  }

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return { error: tFor(c.req.raw.headers).upload.noWorkbook, status: 400 as const };
  const upload = readUpload(tFor(c.req.raw.headers), new Uint8Array(await file.arrayBuffer()));
  if ("error" in upload) return upload;
  return { bytes: upload.bytes, fields: form, filename: file.name || "workbook.xlsx" };
}

function isPublicImportError(error: unknown) {
  return (
    error instanceof Error &&
    ((typeof error === "object" && "kind" in error) ||
      error.name === "WorkbookLimitError" ||
      error.name === "TemporaryWorkbookError")
  );
}

function isInvalidImportRequest(error: unknown) {
  return error instanceof Error && (error.name === "ZodError" || error instanceof SyntaxError);
}

function logUnexpectedImportError(error: unknown) {
  console.error("Unexpected workbook import error", error);
}

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type ProjectCreateAccess =
  | { error: string; status: 401 | 403 | 404 | 409 }
  | { session: AuthSession; companyId: string };

async function requireProjectCreate(c: HonoRequestContext): Promise<ProjectCreateAccess> {
  const session = await activeSession(c);
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (!hasPermission(roleOf(session.user), "project:create")) {
    return { error: "Not found", status: 404 as const };
  }
  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) return { error: scope.error, status: scope.status };
  return { session, companyId: scope.companyId };
}

async function consumeWorkbookRequestLimit(userId: string, scope: string, limit: number) {
  const expired = sql`${workbookRequestLimit.windowStartedAt} <= now() - interval '10 minutes'`;
  const [consumed] = await db
    .insert(workbookRequestLimit)
    .values({ userId, scope, requestCount: 1 })
    .onConflictDoUpdate({
      target: [workbookRequestLimit.userId, workbookRequestLimit.scope],
      set: {
        requestCount: sql`case when ${expired} then 1 else ${workbookRequestLimit.requestCount} + 1 end`,
        windowStartedAt: sql`case when ${expired} then now() else ${workbookRequestLimit.windowStartedAt} end`,
      },
      where: sql`${expired} or ${workbookRequestLimit.requestCount} < ${limit}`,
    })
    .returning({ requestCount: workbookRequestLimit.requestCount });
  return Boolean(consumed);
}

/**
 * Spends one AI import credit, or reports that there are none left.
 *
 * Conditional in the UPDATE rather than read-then-write, for the same reason
 * consumeWorkbookRequestLimit is: two uploads racing on the last credit must
 * not both find it there. A non-trial account has a null balance and is never
 * charged — the WHERE excludes it, and `charged: false` says so.
 */
async function spendTrialAiCredit(userId: string) {
  const chargeId = crypto.randomUUID();
  const charged = await db.execute<{ remaining: number }>(sql`
    with charged as (
      update "user"
      set trial_ai_credits = trial_ai_credits - 1
      where id = ${userId} and trial_ai_credits > 0
      returning id, trial_ai_credits as remaining
    ), recorded as (
      insert into ai_credit_refund (id, user_id, status)
      select ${chargeId}, id, 'pending' from charged
      returning user_id
    )
    select charged.remaining
    from charged inner join recorded on recorded.user_id = charged.id
  `);
  const row = charged.rows[0];

  if (row) return { charged: true as const, chargeId, remaining: row.remaining ?? 0 };

  // Either not a trial account (null balance) or genuinely out. Only the
  // second is a refusal, so ask which.
  const [account] = await db
    .select({ credits: user.trialAiCredits })
    .from(user)
    .where(eq(user.id, userId));
  return { charged: false as const, exhausted: account?.credits !== null && account?.credits !== undefined };
}

/** Hands a credit back when the model was never reached. */
async function settleTrialAiCredit(userId: string, chargeId: string, status: "spent" | "refunded") {
  await db.execute(sql`
    with settled as (
      update ai_credit_refund
      set status = ${status}, settled_at = now()
      where id = ${chargeId} and user_id = ${userId} and status = 'pending'
      returning user_id
    )
    update "user"
    set trial_ai_credits = trial_ai_credits + case when ${status} = 'refunded' then 1 else 0 end
    from settled
    where "user".id = settled.user_id and "user".trial_ai_credits is not null
  `);
}

function workbookUpdateBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TemporaryWorkbookError("The workbook request is invalid.");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.pathname !== "string") {
    throw new TemporaryWorkbookError("The temporary workbook reference is missing.");
  }
  const filename =
    typeof body.filename === "string" && body.filename.trim()
      ? body.filename.slice(0, 255)
      : "workbook.xlsx";
  return { body, pathname: body.pathname, filename };
}

function workbookUpdateFailure(error: unknown) {
  const invalidRequest = isInvalidImportRequest(error);
  if (!isPublicImportError(error) && !invalidRequest) logUnexpectedImportError(error);
  const conflict =
    error instanceof Error && typeof error === "object" && "kind" in error && error.kind === "conflict";
  return {
    body: {
      error:
        isPublicImportError(error) && error instanceof Error
          ? error.message
          : "The workbook update could not be completed.",
      code:
        error instanceof Error && typeof error === "object" && "code" in error
          ? (error as { code?: string | null }).code
          : null,
    },
    status: (conflict ? 409 : isPublicImportError(error) || invalidRequest ? 422 : 500) as
      | 409
      | 422
      | 500,
  };
}

app.post("/projects/:id/workbook-update/upload", async (c) => {
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken || !env.CRON_SECRET) {
    return c.json({ error: tFor(c.req.raw.headers).upload.notConfigured }, 503);
  }

  let body: HandleUploadBody;
  try {
    body = (await c.req.json()) as HandleUploadBody;
  } catch {
    return c.json({ error: tFor(c.req.raw.headers).upload.invalidRequest }, 400);
  }

  try {
    const response = await handleUpload({
      body,
      request: c.req.raw,
      token: blobToken,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const projectId = c.req.param("id");
        const access = await requireProjectWrite(c, projectId);
        if (!("session" in access)) throw new TemporaryWorkbookError(access.error);
        if (!(await consumeWorkbookRequestLimit(access.session.user.id, "update-upload", 40))) {
          throw new TemporaryWorkbookError("Too many workbook uploads. Try again in a few minutes.");
        }
        assertTemporaryWorkbookPath(pathname, `${projectId}/${access.session.user.id}`);
        const payload = clientPayload ? (JSON.parse(clientPayload) as unknown) : null;
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          (payload as { projectId?: unknown }).projectId !== projectId
        ) {
          throw new TemporaryWorkbookError("The upload is not assigned to this project.");
        }
        return {
          allowedContentTypes: [XLSX_CONTENT_TYPE],
          maximumSizeInBytes: MAX_AI_WORKBOOK_BYTES,
          addRandomSuffix: true,
          cacheControlMaxAge: 60,
          validUntil: Date.now() + 10 * 60 * 1000,
          callbackUrl: `${env.CORS_ORIGIN}/api/projects/${projectId}/workbook-update/upload`,
          tokenPayload: JSON.stringify({ projectId, userId: access.session.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const payload = JSON.parse(tokenPayload ?? "") as {
            projectId?: unknown;
            userId?: unknown;
          };
          if (typeof payload.projectId !== "string") throw new Error();
          if (typeof payload.userId !== "string") throw new Error();
          assertTemporaryWorkbookPath(blob.pathname, `${payload.projectId}/${payload.userId}`);
        } catch {
          // A callback that cannot be tied back to its authorized project is not
          // allowed to leave an object behind.
          await del(blob.pathname);
          throw new TemporaryWorkbookError("The completed workbook upload is invalid.");
        }
      },
    });
    return c.json(response);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "The workbook could not be uploaded." },
      400,
    );
  }
});

app.post("/project-import/upload", async (c) => {
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken || !env.CRON_SECRET) {
    return c.json({ error: tFor(c.req.raw.headers).upload.notConfigured }, 503);
  }

  let body: HandleUploadBody;
  try {
    body = (await c.req.json()) as HandleUploadBody;
  } catch {
    return c.json({ error: tFor(c.req.raw.headers).upload.invalidRequest }, 400);
  }

  try {
    const response = await handleUpload({
      body,
      request: c.req.raw,
      token: blobToken,
      onBeforeGenerateToken: async (pathname) => {
        const access = await requireProjectCreate(c);
        if (!("session" in access)) throw new TemporaryWorkbookError(access.error);
        if (!(await consumeWorkbookRequestLimit(access.session.user.id, "create-upload", 30))) {
          throw new TemporaryWorkbookError("Too many workbook uploads. Try again in a few minutes.");
        }
        assertTemporaryWorkbookPath(pathname, `project-import/${access.session.user.id}`);
        return {
          allowedContentTypes: [XLSX_CONTENT_TYPE],
          maximumSizeInBytes: MAX_AI_WORKBOOK_BYTES,
          addRandomSuffix: true,
          cacheControlMaxAge: 60,
          validUntil: Date.now() + 10 * 60 * 1000,
          callbackUrl: `${env.CORS_ORIGIN}/api/project-import/upload`,
          tokenPayload: JSON.stringify({ userId: access.session.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const payload = JSON.parse(tokenPayload ?? "") as { userId?: unknown };
          if (typeof payload.userId !== "string") throw new Error();
          assertTemporaryWorkbookPath(blob.pathname, `project-import/${payload.userId}`);
        } catch {
          await del(blob.pathname);
          throw new TemporaryWorkbookError("The completed workbook upload is invalid.");
        }
      },
    });
    return c.json(response);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "The workbook could not be uploaded." },
      400,
    );
  }
});

app.post("/projects/:id/workbook-update/discover", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);

  try {
    const parsed = workbookUpdateBody(await c.req.json());
    const owner = `${projectId}/${access.session.user.id}`;
    if (!(await consumeWorkbookRequestLimit(access.session.user.id, "update-discover", 20))) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.uploads,
          }) }, 429);
    }
    return c.json(
      await consumeTemporaryWorkbook({
        pathname: parsed.pathname,
        projectId: owner,
        run: async ({ bytes }) => {
          const { loadWorkbook } = await import("./boq-import-parse");
          const {
            discoverProjectWorkbookSheets,
            recommendProjectWorkbookSheet,
            visibleProjectWorkbookSheets,
          } = await import("./project-workbook");
          const workbook = await loadWorkbook(bytes);
          const sheets = visibleProjectWorkbookSheets(discoverProjectWorkbookSheets(workbook));
          return {
            sheets,
            recommendedSheetName:
              recommendProjectWorkbookSheet(sheets, access.project)?.sheetName ?? null,
          };
        },
      }),
    );
  } catch (error) {
    const failure = workbookUpdateFailure(error);
    return c.json(failure.body, failure.status);
  }
});

app.post("/projects/:id/workbook-update/analyze", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);
  let parsed: ReturnType<typeof workbookUpdateBody>;
  try {
    parsed = workbookUpdateBody(await c.req.json());
  } catch (error) {
    const failure = workbookUpdateFailure(error);
    return c.json(failure.body, failure.status);
  }
  const owner = `${projectId}/${access.session.user.id}`;
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "update-analyze", 10))) {
    await discardTemporaryWorkbook(parsed.pathname, owner);
    return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.analyses,
          }) }, 429);
  }

  const credit = await spendTrialAiCredit(access.session.user.id);
  if (!credit.charged && credit.exhausted) {
    await discardTemporaryWorkbook(parsed.pathname, owner);
    return c.json(
      { error: tFor(c.req.raw.headers).upload.aiAllowanceUsedUp, code: TRIAL_AI_EXHAUSTED },
      403,
    );
  }
  let settled = false;
  let spent = false;
  const refund = async () => {
    if (!credit.charged || settled) return;
    await settleTrialAiCredit(access.session.user.id, credit.chargeId, "refunded");
    settled = true;
  };

  try {
    const selectedSheetName = parsed.body.selectedSheetName;
    if (typeof selectedSheetName !== "string" || !selectedSheetName) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      throw new TemporaryWorkbookError("Choose a worksheet to analyze.");
    }
    const existingActualsPromise = db
      .select({
        periodIndex: reportingPeriod.periodIndex,
        cumulativePercent: projectActualCurve.cumulativePercent,
      })
      .from(projectActualCurve)
      .innerJoin(reportingPeriod, eq(reportingPeriod.id, projectActualCurve.periodId))
      .where(eq(projectActualCurve.projectId, projectId))
      .orderBy(asc(reportingPeriod.periodIndex));
    const progressReviewPromise = db.execute<{
      activeVersionId: string | null;
      progressEntryCount: number;
      latestProgressUpdatedAt: Date | string | null;
    }>(sql`
      select
        active.id as "activeVersionId",
        count(entry.id)::integer as "progressEntryCount",
        date_trunc('milliseconds', max(entry.updated_at)) as "latestProgressUpdatedAt"
      from boq_version active
      left join boq_item item on item.boq_version_id = active.id
      left join progress_entry entry on entry.boq_item_id = item.id
      where active.project_id = ${projectId} and active.status = 'active'
      group by active.id
      limit 1
    `);
    const analysis = await consumeTemporaryWorkbook({
      pathname: parsed.pathname,
      projectId: owner,
      run: async ({ bytes }) => {
        const { analyzeProjectWorkbook } = await import("./project-workbook");
        return analyzeProjectWorkbook(bytes, undefined, selectedSheetName, async () => {
          if (credit.charged) {
            await settleTrialAiCredit(access.session.user.id, credit.chargeId, "spent");
          }
          spent = true;
          settled = true;
        });
      },
    });
    if (!settled) await refund();
    const existingActualSnapshots = (await existingActualsPromise).map((snapshot) => ({
      periodIndex: snapshot.periodIndex,
      cumulativePercent: Number(snapshot.cumulativePercent),
    }));
    const progressReview = (await progressReviewPromise).rows[0] ?? {
      activeVersionId: null,
      progressEntryCount: 0,
      latestProgressUpdatedAt: null,
    };
    const { updatedAt, ...currentProject } = access.project;
    const latestProgressUpdatedAt = progressReview.latestProgressUpdatedAt
      ? new Date(progressReview.latestProgressUpdatedAt).toISOString()
      : null;
    const reviewed = {
      ...analysis,
      currentProject,
      existingActualSnapshots,
      reviewState: {
        project: {
          code: currentProject.code,
          name: currentProject.name,
          client: currentProject.client,
          location: currentProject.location,
          startDate: currentProject.startDate,
          scheduleStart: currentProject.scheduleStart,
          endDate: currentProject.endDate,
          periodType: currentProject.periodType,
          periodLengthDays: currentProject.periodLengthDays,
        },
        existingActualSnapshots,
        activeVersionId: progressReview.activeVersionId,
        progressEntryCount: Number(progressReview.progressEntryCount),
        latestProgressUpdatedAt,
      },
    };
    return c.json(
      credit.charged && spent
        ? { ...reviewed, trialAiCreditsLeft: credit.remaining }
        : reviewed,
    );
  } catch (error) {
    await refund();
    const failure = workbookUpdateFailure(error);
    return c.json(failure.body, failure.status);
  }
});

app.post("/projects/:id/workbook-update/commit", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);

  try {
    const parsed = workbookUpdateBody(await c.req.json());
    const owner = `${projectId}/${access.session.user.id}`;
    if (!(await consumeWorkbookRequestLimit(access.session.user.id, "update-commit", 10))) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.updates,
          }) }, 429);
    }
    const selectedSheetName = parsed.body.selectedSheetName;
    const sections = parsed.body.sections;
    if (typeof selectedSheetName !== "string" || !selectedSheetName) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      throw new TemporaryWorkbookError("Choose a worksheet to import.");
    }
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      throw new TemporaryWorkbookError("Choose which project sections to update.");
    }
    if (!parsed.body.plan || typeof parsed.body.plan !== "object" || Array.isArray(parsed.body.plan)) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      throw new TemporaryWorkbookError("Review the workbook before applying this update.");
    }
    const requestedSections = {
      projectDetails: (sections as Record<string, unknown>).projectDetails === true,
      boq: (sections as Record<string, unknown>).boq === true,
      schedule: (sections as Record<string, unknown>).schedule === true,
      progress: (sections as Record<string, unknown>).progress === true,
    };
    if (
      requestedSections.projectDetails &&
      !hasPermission(roleOf(access.session.user), "project:update")
    ) {
      await discardTemporaryWorkbook(parsed.pathname, owner);
      return c.json({ error: "Not found" }, 404);
    }
    const result = await consumeTemporaryWorkbook({
      pathname: parsed.pathname,
      projectId: owner,
      run: async ({ bytes }) => {
        const { commitProjectWorkbookUpdate } = await import("./project-workbook-update");
        return commitProjectWorkbookUpdate({
          bytes,
          filename: parsed.filename,
          projectId,
          companyId: access.companyId,
          selectedSheetName,
          plan: parsed.body.plan,
          sections: requestedSections,
          reviewState: parsed.body.reviewState,
          confirmed:
            parsed.body.confirmed &&
            typeof parsed.body.confirmed === "object" &&
            !Array.isArray(parsed.body.confirmed)
              ? parsed.body.confirmed
              : undefined,
          actor: {
            id: access.session.user.id,
            name: access.session.user.name || access.session.user.email,
          },
        });
      },
    });
    await recordActivity(
      {
        session: access.session,
        companyId: access.companyId,
      },
      {
        action: "updated",
        entityType: "project",
        entityId: projectId,
        entityLabel: access.project.code,
        detail: `Workbook update: ${result.sectionsUpdated.join(", ")}`,
      },
    );
    return c.json(result);
  } catch (error) {
    const failure = workbookUpdateFailure(error);
    return c.json(failure.body, failure.status);
  }
});

app.get("/internal/temporary-workbooks/cleanup", async (c) => {
  if (!env.CRON_SECRET || c.req.header("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ deleted: await purgeExpiredTemporaryWorkbooks() });
});

app.post("/project-import/discover", async (c) => {
  const access = await requireProjectCreate(c);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);
  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "discover", 20))) {
    return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.uploads,
          }) }, 429);
  }

  try {
    const { loadWorkbook } = await import("./boq-import-parse");
    const {
      discoverProjectWorkbookSheets,
      recommendProjectWorkbookSheet,
      visibleProjectWorkbookSheets,
    } = await import("./project-workbook");
    const workbook = await loadWorkbook(upload.bytes);
    const sheets = visibleProjectWorkbookSheets(discoverProjectWorkbookSheets(workbook));
    return c.json({
      sheets,
      recommendedSheetName: recommendProjectWorkbookSheet(sheets)?.sheetName ?? null,
    });
  } catch (error) {
    const invalidRequest = isInvalidImportRequest(error);
    if (!isPublicImportError(error) && !invalidRequest) logUnexpectedImportError(error);
    return c.json(
      {
        error:
          isPublicImportError(error) && error instanceof Error
            ? error.message
            : "The workbook worksheets could not be read.",
      },
      (isPublicImportError(error) ? 400 : 500) as 400 | 500,
    );
  }
});

app.post("/project-import/analyze", async (c) => {
  const access = await requireProjectCreate(c);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);

  // One-use Blob requests are consumed before any application-level refusal,
  // so an exhausted allowance or rate limit cannot leave the upload behind.
  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "analyze", 10))) {
    return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.analyses,
          }) }, 429);
  }
  const selectedSheetName = upload.fields.selectedSheetName;
  if (typeof selectedSheetName !== "string" || !selectedSheetName) {
    return c.json({ error: tFor(c.req.raw.headers).upload.chooseWorksheet }, 400);
  }

  // Charged up front and handed back below if the model turned out not to be
  // needed. The other order — analyse, then charge — cannot refuse anything,
  // because by the time it knows the balance the tokens are already spent.
  const credit = await spendTrialAiCredit(access.session.user.id);
  if (!credit.charged && credit.exhausted) {
    return c.json(
      { error: tFor(c.req.raw.headers).upload.aiAllowanceUsedUp, code: TRIAL_AI_EXHAUSTED },
      403,
    );
  }

  /*
   * The charge is settled exactly once, whichever way this request ends.
   * Both endings used to refund on their own, and a run that handed the credit
   * back and *then* died writing its result refunded twice — the trial came out
   * of a failed import with more credits than it went in with. `settled` also
   * marks a credit that was legitimately spent, so a failure after the model
   * answered cannot hand back tokens that were really burned.
   */
  let settled = false;
  let spent = false;
  const handBackCredit = async () => {
    if (!credit.charged || settled) return;
    await settleTrialAiCredit(access.session.user.id, credit.chargeId, "refunded");
    settled = true;
  };

  /** Shared by both response shapes, so they cannot disagree about the outcome. */
  const run = async (onStage: (stage: string) => void) => {
    const { analyzeProjectWorkbook } = await import("./project-workbook");
    const analysis = await analyzeProjectWorkbook(upload.bytes, onStage, selectedSheetName, async () => {
      if (credit.charged) {
        await settleTrialAiCredit(access.session.user.id, credit.chargeId, "spent");
      }
      spent = true;
      settled = true;
    });
    if (!settled) {
      await handBackCredit();
      return analysis;
    }
    return credit.charged && spent
      ? { ...analysis, trialAiCreditsLeft: credit.remaining }
      : analysis;
  };

  const failure = async (error: unknown) => {
    // A workbook that could not be read never reached the model either.
    await handBackCredit();
    const invalidRequest = isInvalidImportRequest(error);
    if (!isPublicImportError(error) && !invalidRequest) logUnexpectedImportError(error);
    return {
      body: {
        error:
          isPublicImportError(error) && error instanceof Error
            ? error.message
            : "The workbook could not be analyzed.",
      },
      status: (isPublicImportError(error) ? 400 : 500) as 400 | 500,
    };
  };

  /*
   * Streamed only when asked for. The client sends the NDJSON Accept header and
   * falls back to reading this as one JSON body if the stream never arrives —
   * Vercel routes /api/* to this service through a rewrite, and a proxy hop is
   * where streaming quietly turns back into buffering. Keeping both shapes on
   * one route means the fallback is a header away rather than a second endpoint.
   */
  if (!c.req.header("accept")?.includes(NDJSON_CONTENT_TYPE)) {
    try {
      return c.json(await run(() => {}));
    } catch (error) {
      const { body, status } = await failure(error);
      return c.json(body, status);
    }
  }

  // hono's stream() sets no content type, and the client decides how to read
  // the body by looking at one — without this it falls back to JSON.parse and
  // chokes on the second line.
  c.header("Content-Type", NDJSON_CONTENT_TYPE);
  // Proxies that buffer to "help" would defeat the point of streaming at all.
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (writer) => {
    // Every line is one JSON object. A status code is already committed by the
    // time the first stage is written, so failures ride the body as a final
    // line rather than a status — the client reads the last line either way.
    const write = (payload: unknown) =>
      writer.write(JSON.stringify(payload) + "\n");
    try {
      const analysis = await run((stage) => {
        void write({ stage });
      });
      await write({ done: true, result: analysis });
    } catch (error) {
      const { body, status } = await failure(error);
      // The 200 went out with the first stage line, so nothing downstream can
      // tell this apart from a clean import. Say so in the log, or an outage
      // here reads as a perfect success rate.
      console.error(`Streamed workbook analyze failed with status ${status}`);
      await write({ ...body, status });
    }
  });
});

app.post("/project-import/review", async (c) => {
  const access = await requireProjectCreate(c);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);
  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "review", 30))) {
    return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.reviews,
          }) }, 429);
  }

  try {
    const { reviewProjectWorkbook, workbookPlanSchema } = await import("./project-workbook");
    const plan = workbookPlanSchema.parse(
      typeof upload.fields.plan === "string"
        ? JSON.parse(upload.fields.plan)
        : upload.fields.plan,
    );
    return c.json(await reviewProjectWorkbook(upload.bytes, plan));
  } catch (error) {
    const invalidRequest = isInvalidImportRequest(error);
    if (!isPublicImportError(error) && !invalidRequest) logUnexpectedImportError(error);
    return c.json(
      {
        error:
          isPublicImportError(error) && error instanceof Error
            ? error.message
            : "The import plan could not be reviewed.",
      },
      isPublicImportError(error) || invalidRequest ? 422 : 500,
    );
  }
});

app.post("/project-import/commit", async (c) => {
  const access = await requireProjectCreate(c);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);
  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "commit", 10))) {
    return c.json({ error: interpolate(tFor(c.req.raw.headers).upload.rateLimited, {
            operation: tFor(c.req.raw.headers).enums.workbookOperation.imports,
          }) }, 429);
  }

  let submitted: unknown;
  try {
    submitted =
      typeof upload.fields.confirmed === "string"
        ? JSON.parse(upload.fields.confirmed)
        : upload.fields.confirmed;
    if (!submitted) throw new Error();
  } catch {
    return c.json({ error: tFor(c.req.raw.headers).upload.planUnreadable }, 400);
  }

  try {
    const { commitProjectWorkbook } = await import("./project-workbook-commit");
    const outcome = await commitProjectWorkbook({
      bytes: upload.bytes,
      filename: upload.filename,
      confirmed: submitted as Parameters<typeof commitProjectWorkbook>[0]["confirmed"],
      companyId: access.companyId,
      actor: {
        id: access.session.user.id,
        name: access.session.user.name,
        role: roleOf(access.session.user),
      },
    });
    await recordActivity(
      { session: access.session, companyId: access.companyId },
      {
        action: "created",
        entityType: "project",
        entityId: outcome.projectId,
        entityLabel: `${String((submitted as { project?: { code?: string } }).project?.code ?? "").toUpperCase()} - ${String((submitted as { project?: { name?: string } }).project?.name ?? "")}`,
        detail: `Created from ${upload.filename}: ${outcome.rowsImported} BoQ row(s), ${outcome.periodCount} period(s)`,
      },
    );
    return c.json(outcome);
  } catch (error) {
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : error && typeof error === "object" && "cause" in error
          ? String((error as { cause?: { code?: unknown } }).cause?.code ?? "")
          : "";
    if (databaseCode === "23505") {
      return c.json({ error: tFor(c.req.raw.headers).upload.projectCodeInUse }, 409);
    }
    const isPublic = isPublicImportError(error);
    const invalidRequest = isInvalidImportRequest(error);
    if (!isPublic && !invalidRequest) logUnexpectedImportError(error);
    const body = {
      error:
        isPublic && error instanceof Error
          ? error.message
          : "The project could not be created.",
      code:
        error && typeof error === "object" && "kind" in error && "code" in error
          ? (error as { code: unknown }).code
          : undefined,
      details:
        error && typeof error === "object" && "kind" in error && "details" in error
          ? (error as { details: unknown }).details
          : undefined,
      errors:
        error && typeof error === "object" && "errors" in error
          ? (error as { errors: unknown }).errors
          : undefined,
    };
    if (error && typeof error === "object" && "kind" in error) {
      return c.json(body, (error as { kind: string }).kind === "conflict" ? 409 : 422);
    }
    if (isPublic) return c.json(body, 422);
    if (invalidRequest) return c.json(body, 400);
    return c.json(body, 500);
  }
});

app.post("/projects/:id/boq-import/preview", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if ("error" in access) return c.json({ error: access.error }, access.status);

  const upload = await readUpload(tFor(c.req.raw.headers), new Uint8Array(await c.req.arrayBuffer()));
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  // Lazy for the same reason as the portfolio export — this module pulls
  // exceljs, and an eager import puts it back in the boot graph.
  const { previewWorkbook } = await import("./boq-import");
  try {
    return c.json(await previewWorkbook(upload.bytes));
  } catch {
    // A corrupt or non-xlsx upload throws from deep inside the zip reader; the
    // message is about central directories and helps nobody.
    return c.json({ error: tFor(c.req.raw.headers).upload.notXlsx }, 400);
  }
});

app.post("/projects/:id/boq-import/commit", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if ("error" in access) return c.json({ error: access.error }, access.status);

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ error: tFor(c.req.raw.headers).upload.noWorkbook }, 400);
  }

  const upload = await readUpload(tFor(c.req.raw.headers), new Uint8Array(await file.arrayBuffer()));
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  let plan: { sheetName: string; headerRow: number; mapping: unknown };
  try {
    plan = JSON.parse(String(form.plan));
  } catch {
    return c.json({ error: tFor(c.req.raw.headers).upload.mappingUnreadable }, 400);
  }

  let outcome;
  try {
    const { commitImport } = await import("./boq-import");
    outcome = await commitImport({
      projectId,
      bytes: upload.bytes,
      filename: file.name || "workbook.xlsx",
      sheetName: plan.sheetName,
      headerRow: plan.headerRow,
      mapping: plan.mapping as Parameters<typeof commitImport>[0]["mapping"],
      actor: { id: access.session.user.id, name: access.session.user.name },
    });
  } catch (error) {
    if (isPublicImportError(error)) {
      return c.json({ error: error instanceof Error ? error.message : "Import rejected." }, 422);
    }
    logUnexpectedImportError(error);
    return c.json({ error: tFor(c.req.raw.headers).upload.importFailed }, 500);
  }

  if (outcome.status === "rejected") {
    return c.json({ error: outcome.message }, 409);
  }
  if (outcome.status === "failed") {
    // 422, not 400: the request was well-formed and the file was readable — the
    // rows in it were not. Nothing was written beyond the record of the attempt.
    return c.json(outcome, 422);
  }

  await recordActivity(
    { session: access.session, companyId: access.companyId },
    {
      action: "imported",
      entityType: "boq",
      entityId: outcome.versionId,
      entityLabel: `${access.project.code} - ${access.project.name}`,
      detail: `Rev ${outcome.versionNo} - ${outcome.rowsImported} line(s) from ${file.name}`,
    },
  );

  return c.json(outcome);
});

app.get("/projects/:id/boq-import/:importId/errors.csv", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectAccess(c, projectId);
  if ("error" in access) return c.json({ error: access.error }, access.status);

  const { errorReportCsv, getImportRecord } = await import("./boq-import");
  const record = await getImportRecord(c.req.param("importId"));
  // The id alone is not authority to read it — the import must belong to the
  // project whose access was just checked.
  if (!record || record.projectId !== projectId) {
    return c.json({ error: "Not found" }, 404);
  }

  const errors = record.errors ? (JSON.parse(record.errors) as Parameters<typeof errorReportCsv>[0]) : [];
  return c.body(errorReportCsv(errors), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${record.filename.replace(/\.[^.]+$/, "")}-errors.csv"`,
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
