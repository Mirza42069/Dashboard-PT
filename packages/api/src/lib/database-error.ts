/** Searches wrapped database-driver errors without depending on one wrapper shape. */
export function databaseErrorIncludes(error: unknown, fragment: string) {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message.toLowerCase().includes(fragment.toLowerCase())) {
      return true;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}
