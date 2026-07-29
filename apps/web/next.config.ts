import "@DashboardV2/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,

  // better-auth resolves its adapters dynamically, so bundling it into the
  // route chunks is wasted work — lib/session.ts only ever runs on the server.
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely"],

  experimental: {
    /**
     * Client-side router cache. `dynamic` defaults to 0, which is why moving
     * between sidebar tabs refetched the RSC payload every single time — a
     * fresh function invocation per click even when nothing had changed.
     *
     * 30s deliberately matches the React Query staleTime in utils/trpc.ts, so
     * the navigation cache and the data cache expire together instead of one
     * serving a shell the other immediately refills. Mutations still call
     * invalidateQueries, and router.refresh() still bypasses this, so edits
     * show up straight away.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
