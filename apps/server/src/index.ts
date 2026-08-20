import { createContext } from "@DashboardV2/api/context";
import { recordActivity } from "@DashboardV2/api/lib/activity";
import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import { appRouter } from "@DashboardV2/api/routers/index";
import { auth } from "@DashboardV2/auth";
import { projectAccessFilter, resolveCompanyIdForSession } from "@DashboardV2/api/lib/scope";
import { TRIAL_AI_EXHAUSTED, trialHasEnded } from "@DashboardV2/api/lib/trial";
import { db } from "@DashboardV2/db";
import {
  notePhoto,
  project,
  projectMember,
  projectNote,
  user,
  workbookRequestLimit,
} from "@DashboardV2/db/schema";
import { trustedOrigins } from "@DashboardV2/env/server";
import { trpcServer } from "@hono/trpc-server";
import { and, eq, exists, sql } from "drizzle-orm";
import { Hono, type Context as HonoRequestContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { stream } from "hono/streaming";

import {
  decodeWorkbookTransport,
  WORKBOOK_TRANSPORT_CONTENT_TYPE,
  WorkbookTransportError,
} from "./workbook-transport";

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
  return trialHasEnded(session.user) ? null : session;
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
  const session = await activeSession(c);
  if (!session) {
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
    locale: c.req.query("locale") === "id" ? "id" : "en",
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
async function requireProjectWrite(c: HonoRequestContext, projectId: string) {
  const session = await activeSession(c);
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (!hasPermission(roleOf(session.user), "project:write")) {
    return { error: "Not found", status: 404 as const };
  }

  const scope = await resolveCompany(session.user, c.req.raw.headers);
  if ("error" in scope) return { error: scope.error, status: scope.status };

  const [visible] = await db
    .select({ code: project.code, name: project.name })
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

/** Reads the uploaded workbook, refusing anything past the body limit. */
function readUpload(
  bytes: Uint8Array,
): { bytes: Uint8Array } | { error: string; status: 400 | 413 } {
  if (bytes.byteLength === 0) return { error: "Empty upload", status: 400 as const };
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { error: "The workbook exceeds the 4 MB upload limit", status: 413 as const };
  }
  return { bytes };
}

async function readWorkbookRequest(c: HonoRequestContext) {
  if ((c.req.header("content-type") ?? "").startsWith(WORKBOOK_TRANSPORT_CONTENT_TYPE)) {
    try {
      const decoded = decodeWorkbookTransport(new Uint8Array(await c.req.arrayBuffer()));
      const upload = readUpload(decoded.bytes);
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
  if (!(file instanceof File)) return { error: "No workbook was attached.", status: 400 as const };
  const upload = readUpload(new Uint8Array(await file.arrayBuffer()));
  if ("error" in upload) return upload;
  return { bytes: upload.bytes, fields: form, filename: file.name || "workbook.xlsx" };
}

function isPublicImportError(error: unknown) {
  return (
    error instanceof Error &&
    ((typeof error === "object" && "kind" in error) || error.name === "WorkbookLimitError")
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
  if (!scope.companyId) {
    return { error: scope.error ?? "No company assigned", status: scope.status ?? 409 };
  }
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
  const [row] = await db
    .update(user)
    .set({ trialAiCredits: sql`${user.trialAiCredits} - 1` })
    .where(and(eq(user.id, userId), sql`${user.trialAiCredits} > 0`))
    .returning({ remaining: user.trialAiCredits });

  if (row) return { charged: true as const, remaining: row.remaining ?? 0 };

  // Either not a trial account (null balance) or genuinely out. Only the
  // second is a refusal, so ask which.
  const [account] = await db
    .select({ credits: user.trialAiCredits })
    .from(user)
    .where(eq(user.id, userId));
  return { charged: false as const, exhausted: account?.credits !== null && account?.credits !== undefined };
}

/** Hands a credit back when the model was never reached. */
async function refundTrialAiCredit(userId: string) {
  await db
    .update(user)
    .set({ trialAiCredits: sql`${user.trialAiCredits} + 1` })
    .where(and(eq(user.id, userId), sql`${user.trialAiCredits} is not null`));
}

app.post("/project-import/analyze", async (c) => {
  const access = await requireProjectCreate(c);
  if (!("session" in access)) return c.json({ error: access.error }, access.status);
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "analyze", 10))) {
    return c.json({ error: "Too many workbook analyses. Try again in a few minutes." }, 429);
  }

  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  // Charged up front and handed back below if the model turned out not to be
  // needed. The other order — analyse, then charge — cannot refuse anything,
  // because by the time it knows the balance the tokens are already spent.
  const credit = await spendTrialAiCredit(access.session.user.id);
  if (!credit.charged && credit.exhausted) {
    return c.json(
      { error: "This trial's AI import allowance is used up.", code: TRIAL_AI_EXHAUSTED },
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
  const handBackCredit = async () => {
    if (!credit.charged || settled) return;
    settled = true;
    await refundTrialAiCredit(access.session.user.id);
  };

  /** Shared by both response shapes, so they cannot disagree about the outcome. */
  const run = async (onStage: (stage: string) => void) => {
    const { analyzeProjectWorkbook } = await import("./project-workbook");
    const analysis = await analyzeProjectWorkbook(upload.bytes, onStage);
    // The reference Indonesian S-curve template is recognised without the
    // model. Charging for it would sell an allowance the import did not use.
    if (credit.charged && analysis.plan.profile !== "generic-ai") {
      await handBackCredit();
      return analysis;
    }
    // The model answered. Whatever happens downstream, this one is spent.
    settled = true;
    return credit.charged ? { ...analysis, trialAiCreditsLeft: credit.remaining } : analysis;
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
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "review", 30))) {
    return c.json({ error: "Too many workbook reviews. Try again in a few minutes." }, 429);
  }
  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

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
  if (!(await consumeWorkbookRequestLimit(access.session.user.id, "commit", 10))) {
    return c.json({ error: "Too many workbook imports. Try again in a few minutes." }, 429);
  }

  const upload = await readWorkbookRequest(c);
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  let submitted: unknown;
  try {
    submitted =
      typeof upload.fields.confirmed === "string"
        ? JSON.parse(upload.fields.confirmed)
        : upload.fields.confirmed;
    if (!submitted) throw new Error();
  } catch {
    return c.json({ error: "The confirmed import plan could not be read." }, 400);
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
      return c.json({ error: "That project code is already in use." }, 409);
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

  const upload = await readUpload(new Uint8Array(await c.req.arrayBuffer()));
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  // Lazy for the same reason as the portfolio export — this module pulls
  // exceljs, and an eager import puts it back in the boot graph.
  const { previewWorkbook } = await import("./boq-import");
  try {
    return c.json(await previewWorkbook(upload.bytes));
  } catch {
    // A corrupt or non-xlsx upload throws from deep inside the zip reader; the
    // message is about central directories and helps nobody.
    return c.json({ error: "That file could not be read as an .xlsx workbook." }, 400);
  }
});

app.post("/projects/:id/boq-import/commit", async (c) => {
  const projectId = c.req.param("id");
  const access = await requireProjectWrite(c, projectId);
  if ("error" in access) return c.json({ error: access.error }, access.status);

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ error: "No workbook was attached." }, 400);
  }

  const upload = await readUpload(new Uint8Array(await file.arrayBuffer()));
  if ("error" in upload) return c.json({ error: upload.error }, upload.status);

  let plan: { sheetName: string; headerRow: number; mapping: unknown };
  try {
    plan = JSON.parse(String(form.plan));
  } catch {
    return c.json({ error: "The column mapping could not be read." }, 400);
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
    return c.json({ error: "The workbook could not be imported." }, 500);
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
  const access = await requireProjectWrite(c, projectId);
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
