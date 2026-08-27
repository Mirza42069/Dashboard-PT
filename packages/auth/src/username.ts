export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string) {
  const normalized = normalizeUsername(value);
  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

export function usernameFromEmail(email: string) {
  const localPart = email.split("@", 1)[0] ?? "";
  const sanitized = normalizeUsername(localPart)
    .replace(/[^a-z0-9_.]/g, "_")
    .slice(0, USERNAME_MAX_LENGTH);
  return sanitized.length >= USERNAME_MIN_LENGTH ? sanitized : `user_${sanitized || "account"}`;
}
