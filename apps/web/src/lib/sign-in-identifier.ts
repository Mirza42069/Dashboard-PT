export function signInMethod(identifier: string): "email" | "username" {
  return identifier.includes("@") ? "email" : "username";
}
