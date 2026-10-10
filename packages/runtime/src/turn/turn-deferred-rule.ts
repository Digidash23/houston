/**
 * The agent's own files: anything under a non-hidden folder of the agent
 * directory (`workspaces/<ws>/<agent>/<dir>/**`, `<dir>` not starting with
 * `.`). That covers chat attachments (`uploads/`, host turn/attachments.ts)
 * and every document the person or the agent made, which together are most
 * of a large agent's bytes. No runtime input lives there: the prompt and the
 * harness read the agent's root context files (CLAUDE.md, AGENTS.md) and its
 * hidden folders (`.houston/`, `.agents/`, `.claude/`), which stay on the
 * critical path. Only a turn's tools read these files, so a claimed turn
 * hydrates them behind the prompt (turn-deferred-files.ts) and a settings or
 * credential op never downloads them at all (op-tree-options.ts). The
 * gateway leaves the same objects out of the turn's inlined prefetch (cloud
 * internal/pooldispatch/prefetch.go), so they never sit on the upload the
 * worker's answer waits for. Keep the two predicates identical.
 */
export function deferredWorkspaceFile(rel: string): boolean {
  const segments = rel.split("/");
  const dir = segments[3];
  return (
    segments.length > 4 &&
    segments[0] === "workspaces" &&
    dir !== undefined &&
    dir !== "" &&
    !dir.startsWith(".")
  );
}
