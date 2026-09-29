import { createHash } from "node:crypto";

/**
 * Where a member's Claude CLI flag cache lives in the agent's store:
 * `<runtime data>/claude-flags/<name>.json` (turn-claude-flags). The name is
 * the first 16 hex of the member id's SHA-256, like `auth-users/`; the
 * gateway's claim scope admits exactly that shape.
 */
export const CLAUDE_FLAGS_DIR = "claude-flags";

/** The member's cache file name inside `claude-flags/`. */
export function claudeFlagsFileName(userId: string): string {
  return `${createHash("sha256").update(userId).digest("hex").slice(0, 16)}.json`;
}
