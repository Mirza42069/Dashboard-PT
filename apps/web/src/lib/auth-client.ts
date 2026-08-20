import { env } from "@DashboardV2/env/web";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getServerUrl } from "./server-url";

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: new URL("/api/auth", getServerUrl(env.NEXT_PUBLIC_SERVER_URL)).toString(),
  plugins: [
    adminClient(),
    // Declared explicitly rather than inferred from the server `auth` instance,
    // so no server module is reachable from the client bundle. Keep in sync
    // with user.additionalFields in packages/auth/src/index.ts.
    inferAdditionalFields({
      user: {
        mustChangePassword: { type: "boolean" },
        trialEndsAt: { type: "date", required: false },
        trialAiCredits: { type: "number", required: false },
      },
    }),
  ],
});

export type SessionUser = typeof authClient.$Infer.Session.user;
export type Session = typeof authClient.$Infer.Session;
