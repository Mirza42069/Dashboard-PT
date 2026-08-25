/**
 * Cookie reading, split out of lib/scope.ts.
 *
 * scope.ts imports `db` at module load, so anything that needs a cookie would
 * otherwise drag a database connection along with it. `lib/messages` needs the
 * locale cookie and nothing else, and it is deliberately dependency-free so it
 * stays unit-testable and importable from anywhere — hence this file.
 */

/** Minimal cookie lookup — the API only ever reads a couple of these. */
export function readCookie(headers: Headers, name: string): string | undefined {
  const header = headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
