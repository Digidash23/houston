/**
 * OBJECT STORE PREFIXES.
 *
 * A prefix names a DIRECTORY, written without a trailing slash: `skills`
 * lists `skills/research/SKILL.md` and never `skills-old/...`. That is how
 * GcsStore (`<prefix>/`) and LocalDirStore (a directory walk) already read
 * it, and how pod-store scopes its manifest.
 *
 * pod-store validates the prefix as an object key and answers anything else
 * with 400 "invalid object prefix": an empty, `.` or `..` segment (so a
 * trailing or doubled slash), a leading slash, a backslash, a control
 * character, or more than 1024 bytes. The HTTP store refuses those before the
 * request, so a caller that writes `skills/` fails in its own tests, not only
 * against a live pod-store.
 */

const MAX_KEY_BYTES = 1024;

/** Whether pod-store accepts `prefix` as `?prefix=` ("" means no prefix). */
export function isObjectPrefix(prefix: string): boolean {
  if (prefix === "") return true;
  if (new TextEncoder().encode(prefix).byteLength > MAX_KEY_BYTES) return false;
  if (prefix.startsWith("/") || prefix.includes("\\")) return false;
  if (/\p{Cc}/u.test(prefix)) return false;
  return prefix
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Whether `key` lies inside the directory `prefix` names. */
export function underObjectPrefix(key: string, prefix: string): boolean {
  return prefix === "" || key.startsWith(`${prefix}/`);
}

export class InvalidObjectPrefixError extends Error {
  constructor(readonly prefix: string) {
    super(
      `invalid object prefix ${JSON.stringify(prefix)}: name a directory without a trailing slash`,
    );
    this.name = "InvalidObjectPrefixError";
  }
}
