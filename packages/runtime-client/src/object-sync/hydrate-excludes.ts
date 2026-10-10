import { basename, sep } from "node:path";
import { isAtomicTemp } from "@houston/protocol";

export const DEFAULT_EXCLUDES = ["data/auth.json"];

/**
 * pnpm's content-addressed store, which pnpm puts at the synced root when the
 * project sits on a different filesystem than `$HOME`. No turn or op reads
 * it, and it is huge: one agent carried 1.2 GiB of it, enough to push a
 * pooled turn over its 2 GiB hydration cap. Shared by the standing store sync
 * and every pooled hydrate so the two cannot drift. Root-only on purpose: the
 * gateway's turn prefetch skips exactly this prefix (cloud
 * internal/pooldispatch/prefetch_package_store.go); keep the two identical.
 */
export const STORE_ROOT_PACKAGE_EXCLUDES: readonly string[] = [".pnpm-store/"];

const norm = (rel: string) => rel.split(sep).join("/");

function segmentGlobMatches(pattern: string, path: string): boolean {
  const subtree = pattern.endsWith("/");
  const want = (subtree ? pattern.slice(0, -1) : pattern).split("/");
  const have = path.split("/");
  if (subtree ? have.length < want.length : have.length !== want.length) {
    return false;
  }
  return want.every((seg, i) => seg === "*" || seg === have[i]);
}

/** Segments of `workspaces/<ws>/<agent>/` a toolchain pattern never matches. */
const AGENT_ROOT_DEPTH = 3;

/**
 * `**\/name/` excludes every file under a directory called `name` at any
 * depth INSIDE an agent: the shape a rebuildable toolchain takes
 * (node_modules, .venv) when an agent installs it somewhere in its workspace.
 * Only directories match; a file that happens to be called `name` is not a
 * toolchain. Under `workspaces/<ws>/<agent>/` the workspace and agent folders
 * are names a person chose, never a toolchain: an agent called "Cache" must
 * not lose its whole tree to `**\/Cache/`, so only segments below the agent
 * root count. Outside `workspaces/` (the store root, `data/`) every directory
 * segment does.
 */
function anyDepthDirMatches(pattern: string, path: string): boolean {
  const dir = pattern.slice("**/".length, -1);
  const segments = path.split("/");
  const first = segments[0] === "workspaces" ? AGENT_ROOT_DEPTH : 0;
  return segments.slice(first, -1).includes(dir);
}

export function excluded(rel: string, excludes: string[]): boolean {
  const normalized = norm(rel);
  // Unconditional, whatever a caller configures: a half-written file must
  // never be published as content. Every atomic write in Houston — host,
  // runtime and this package — names its temp target with ATOMIC_TMP_SUFFIX
  // precisely so this one line can find it, and finds NOTHING else: excluding
  // plain `.tmp` also swallowed the user's own `notes.tmp`, listed in the
  // Files tab and silently dropped at pod teardown.
  if (isAtomicTemp(normalized)) return true;
  // A `.tmp` beside an excluded file is that file's half-written twin from
  // before every atomic write carried ATOMIC_TMP_SUFFIX; a crash could have
  // left `auth.json.tmp` on a pod, and it stays as private as `auth.json`.
  if (
    normalized.endsWith(".tmp") &&
    excluded(normalized.slice(0, -4), excludes)
  )
    return true;
  if (normalized.endsWith(".houston/runtime/auth.json")) return true;
  // Credential paths differ by deployment depth, so segment matching must
  // exclude auth-users unconditionally instead of relying on caller patterns.
  if (normalized.split("/").includes("auth-users")) return true;
  return excludes.some((exclude) => {
    const pattern = norm(exclude);
    if (pattern.startsWith("**/") && pattern.endsWith("/")) {
      return anyDepthDirMatches(pattern, normalized);
    }
    if (pattern.includes("*")) {
      return segmentGlobMatches(pattern, normalized);
    }
    if (pattern.endsWith("/")) {
      const subtree = pattern.slice(0, -1);
      return normalized === subtree || normalized.startsWith(pattern);
    }
    if (!pattern.includes("/")) return basename(normalized) === pattern;
    return normalized === pattern;
  });
}
