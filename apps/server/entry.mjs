/**
 * TEMPORARY DIAGNOSTIC BUILD — not to be merged.
 *
 * The function dies at cold start with an empty `ResolveMessage {}`, which
 * names nothing. This probes each candidate separately and reports what it
 * finds, both to the log and — if the real app cannot be loaded — as the
 * response body, so a single page load settles it.
 *
 * Restore to the one-line re-export once the failing specifier is known.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const report = [];
const note = (line) => {
  report.push(line);
  console.log("[diag]", line);
};

note(`cwd  = ${process.cwd()}`);
note(`here = ${here}`);

for (const rel of [".", "dist", "node_modules", "node_modules/hono", "node_modules/@DashboardV2"]) {
  const path = join(here, rel);
  try {
    note(
      existsSync(path)
        ? `dir ${rel} -> ${readdirSync(path).slice(0, 25).join(", ")}`
        : `dir ${rel} -> MISSING`,
    );
  } catch (error) {
    note(`dir ${rel} -> ERROR ${error.message}`);
  }
}

// The discriminating test. "./dist/index.mjs" failing means the build output is
// not packaged; "hono" failing means node_modules is not traced.
for (const spec of ["./dist/index.mjs", "hono", "better-auth", "@DashboardV2/env/server"]) {
  try {
    await import(spec);
    note(`import ${spec} -> OK`);
  } catch (error) {
    note(`import ${spec} -> FAIL ${error?.name}: ${error?.message ?? String(error)}`);
  }
}

let app;
try {
  app = (await import("./dist/index.mjs")).default;
  note("real app loaded — serving it");
} catch {
  note("real app unavailable — serving diagnostic report");
}

export default (
  app ?? {
    fetch: () =>
      new Response(report.join("\n"), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  }
);
