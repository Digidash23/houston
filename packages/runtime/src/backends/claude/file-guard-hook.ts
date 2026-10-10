import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import {
  WorkspaceGuard,
  type WorkspaceGuardOptions,
} from "../../session/tools/fs-guard";
import { isFileCall, judgeFileCall } from "./file-call-judgment";

/**
 * PreToolUse: the workspace guard for every built-in file call. Claude Code
 * auto-approves reads inside `cwd` under `permissionMode: "default"` without
 * ever asking `canUseTool`, and the runtime's credential files live inside
 * `cwd`. Hooks run for those calls too, so this is where the wall holds;
 * `canUseTool` stays as the second wall for the calls Claude Code does ask
 * about. Build it from the same `fileGuard` object `canUseTool` gets.
 *
 * An allowed call hands back the proven paths through `updatedInput` and no
 * `permissionDecision`, so Claude Code's own permission checks (and
 * `canUseTool`) still run, on the rewritten input.
 */
export function fileGuardHook(
  workspaceDir: string,
  options?: WorkspaceGuardOptions,
): HookCallback {
  const guard = new WorkspaceGuard(workspaceDir, options);
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = input.tool_input;
    const verdict = isRecord(toolInput)
      ? judgeFileCall(guard, input.tool_name, toolInput)
      : isFileCall(input.tool_name)
        ? { behavior: "deny" as const, message: "The tool call had no input." }
        : { behavior: "allow" as const };
    if (verdict.behavior === "deny") return denyToolUse(verdict.message);
    if (!verdict.updatedInput) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: verdict.updatedInput,
      },
    };
  };
}

/** PreToolUse for a query that must run no tool at all (one-shot calls). */
export const denyEveryTool: HookCallback = async () =>
  denyToolUse("Tools are unavailable for this request.");

export function denyToolUse(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
