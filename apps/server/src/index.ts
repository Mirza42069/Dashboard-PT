import { createContext } from "@DashboardV2/api/context";
import { appRouter } from "@DashboardV2/api/routers/index";
import { auth } from "@DashboardV2/auth";
import { env } from "@DashboardV2/env/server";
import { trpcServer } from "@hono/trpc-server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Issues a short-lived token so the browser can upload straight to Vercel Blob.
 * The file never passes through this function — Vercel caps a serverless
 * request body at 4.5 MB, which a phone photo clears easily.
 *
 * Reached from the browser as /api/blob/upload: vercel.json strips the /api
 * prefix for everything except /api/auth, so the path here is /blob/upload.
 *
 * Note there is no onUploadCompleted persistence. That callback is a webhook
 * from Vercel to a public URL and never fires against localhost, so relying on
 * it would work in production and silently break in development. The browser
 * calls note.attachPhoto once the upload resolves instead.
 */
app.post("/blob/upload", async (c) => {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return c.json(
      { error: "Uploads are not configured: BLOB_READ_WRITE_TOKEN is not set." },
      503,
    );
  }

  const body = (await c.req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: c.req.raw,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => {
        // Authorise here or nowhere — once a token is issued, anyone holding it
        // can write to the store.
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!session?.user) {
          throw new Error("Unauthorized");
        }

        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
          maximumSizeInBytes: MAX_PHOTO_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.user.id }),
        };
      },
      onUploadCompleted: async () => {
        // Intentionally empty — see the note above.
      },
    });

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return c.json({ error: message }, message === "Unauthorized" ? 401 : 400);
  }
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
