import type { WorkspaceGuard } from "../../session/tools/fs-guard";
import { isEscapeToken } from "./tool-target-paths";

/**
 * The workspace guard's verdict on one built-in tool call, shared by both walls
 * that run it on the Claude backend: the PreToolUse hook (file-guard-hook.ts),
 * which sees every call, and `canUseTool`, which sees only the calls Claude Code
 * does not auto-approve. One function, so the two cannot disagree.
 *
 * Bash and Houston's own MCP tools are not file calls: Bash keeps its command
 * check in the permission gate, and the MCP tools name no workspace path.
 */

/** The input fields a built-in names its target file or folder with. */
const PATH_FIELDS = ["file_path", "path", "notebook_path"] as const;

/**
 * Built-ins that only read. Any other built-in that names a path is judged as
 * a write, so a file tool a newer SDK adds is held to the stricter rule until
 * it is listed here.
 */
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

/** Built-ins that search a whole folder, the workspace when they name none. */
const SEARCH_TOOLS = new Set(["Glob", "Grep", "LS"]);

export type FileCallVerdict =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isFileCall(toolName: string): boolean {
  return toolName !== "Bash" && !toolName.startsWith("mcp__");
}

/**
 * Judge a file tool call. An allowed call comes back with every path field
 * replaced by the absolute path the guard proved: the tool then opens exactly
 * what was judged, not the model's raw string (`@uploads/x` judged as
 * `uploads/x` but opened as `<cwd>/@uploads/x`, or a symlink repointed between
 * the check and the open).
 */
export function judgeFileCall(
  guard: WorkspaceGuard,
  toolName: string,
  input: Record<string, unknown>,
): FileCallVerdict {
  if (!isFileCall(toolName)) return { behavior: "allow" };
  const judge = isReadOnlyTool(toolName)
    ? (raw: string | undefined) => guard.clamp(raw)
    : (raw: string | undefined) => guard.clampWrite(raw);
  try {
    const updatedInput: Record<string, unknown> = { ...input };
    let rewritten = false;
    for (const field of PATH_FIELDS) {
      const raw = input[field];
      if (raw === undefined) continue;
      if (typeof raw !== "string")
        throw new Error(`The ${field} of a ${toolName} call must be a path.`);
      updatedInput[field] = judge(raw);
      rewritten = true;
    }
    // A search with no folder searches the workspace root, which must itself
    // be in bounds: the coordinator's wall holds no folder at all.
    if (SEARCH_TOOLS.has(toolName) && input.path === undefined)
      judge(undefined);
    // Glob resolves its PATTERN against the folder, so an absolute, `~` or
    // `..` pattern reaches outside it. Grep's pattern is a regex, not a path.
    if (
      toolName === "Glob" &&
      typeof input.pattern === "string" &&
      isEscapeToken(input.pattern)
    )
      judge(input.pattern);
    return rewritten
      ? { behavior: "allow", updatedInput }
      : { behavior: "allow" };
  } catch (err) {
    return {
      behavior: "deny",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
