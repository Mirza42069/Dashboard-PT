import { spawnSync } from "node:child_process";

const result = spawnSync("bun", ["run", "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(process.env.LOCAL_VERCEL_BUILD === "1"
      ? {
          BETTER_AUTH_SECRET: "local-vercel-build-only-secret-32-chars",
          DATABASE_URL: "postgresql://user:password@localhost:5432/local_build",
        }
      : {}),
    NEXT_PUBLIC_SERVER_URL: "/api",
    // `vercel build` does not inject system variables locally. Production does,
    // so provide a non-routable hostname only for local build-time validation.
    VERCEL_ENV: process.env.VERCEL_ENV ?? "production",
    VERCEL_PROJECT_PRODUCTION_URL:
      process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "local-build.invalid",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`Web build failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
