import { isAbsolute } from "node:path";
import { bashWords } from "./bash-words";

/**
 * Path tokens in a Bash command that could escape the workspace: absolute (`/`),
 * home (`~`), or a `..` segment that climbs out of cwd — `cat ../../etc/passwd`
 * is relative AND escapes, so `..` must be caught here too. Each candidate is
 * clamped; any escape denies the whole command.
 *
 * This is NOT a security boundary. Arbitrary Bash is inherently porous —
 * redirections, `$HOME`, env expansion, and `$(...)` command substitution all
 * evade flat token inspection. This layer is defense-in-depth that must at least
 * not fail open on the trivial absolute/`~`/`..` cases. Conservative by design:
 * over-denying an odd path token is safer than leaking a read — but the words
 * are split like a shell splits them, so a quoted or escaped path with a space
 * is judged whole: `"/etc/passwd"` is still one absolute token and still
 * denied, while `".../Personal/neqw copia"` is contained (PRODUCT-1809).
 */
export function bashEscapeCandidates(command: string): string[] {
  return bashWords(command).filter(isEscapeToken);
}

/**
 * A path token or glob pattern that could resolve OUTSIDE the workspace and so
 * must be clamped: an absolute path (leading `/`, a Windows drive/UNC), a `~`
 * home reference, or any `..` segment that can climb out of cwd. Benign relative
 * inputs (a recursive `src` glob, `./sub`) return false and stay under cwd. For
 * glob patterns we deliberately do NOT parse magic — only the leading anchor
 * matters for escape detection.
 */
export function isEscapeToken(token: string): boolean {
  if (isAbsolute(token) || token.startsWith("~")) return true;
  // Split on both separators so a `..` segment is caught on POSIX and Windows.
  return token.split(/[/\\]+/).includes("..");
}
