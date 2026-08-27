export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 120;
const PRINTABLE_BASIC_LATIN_PATTERN = /^[\x20-\x7e]+$/;

export function normalizeAccountName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeUsername(value: string) {
  return normalizeAccountName(value).toLowerCase();
}

export function isValidAccountName(value: string) {
  const displayName = normalizeAccountName(value);
  return (
    displayName.length >= USERNAME_MIN_LENGTH &&
    displayName.length <= USERNAME_MAX_LENGTH &&
    !displayName.includes("@") &&
    PRINTABLE_BASIC_LATIN_PATTERN.test(value)
  );
}

export function usernameFromName(name: string) {
  return normalizeUsername(name);
}
