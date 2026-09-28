/**
 * The first name the AI Manager greets the person by, from the display name
 * their sign-in carries ("Ana María López" → "Ana"). Null when there is none
 * to use, so the hello falls back to its no-name line: no display name, or one
 * that is really an address.
 */
export function firstNameOf(
  displayName: string | null | undefined,
): string | null {
  const first = displayName?.trim().split(/\s+/u)[0] ?? "";
  if (first === "" || first.includes("@")) return null;
  return first;
}
