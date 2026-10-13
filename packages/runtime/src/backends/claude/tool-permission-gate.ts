import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import {
  WorkspaceGuard,
  type WorkspaceGuardOptions,
} from "../../session/tools/fs-guard";
import { currentTurnMode } from "../../session/turn-mode-context";
import {
  isFileCall,
  isReadOnlyTool,
  judgeFileCall,
} from "./file-call-judgment";
import { bashEscapeCandidates } from "./tool-target-paths";

/**
 * The permission gate, the second wall behind the PreToolUse guard
 * (file-guard-hook.ts): Claude Code asks it only about the calls it does not
 * auto-approve. File calls get the same `judgeFileCall` verdict the hook gives,
 * proven paths included. Bash is approved unless its command names a path
 * token that escapes (absolute, `~`, or a `..` segment climbing out of cwd).
 */
/** The mutating/executing built-ins a LIVE flip to plan mode must stop. */
const PLAN_DENIED_TOOLS = new Set(["Edit", "Write", "Bash"]);

export function makeCanUseTool(
  workspaceDir: string,
  guardOptions?: WorkspaceGuardOptions,
): CanUseTool {
  const guard = new WorkspaceGuard(workspaceDir, guardOptions);
  return async (toolName, input, options): Promise<PermissionResult> => {
    // Live plan-mode gate for the mid-turn Mode-pill switch (Claude Code's
    // shift+tab): a session BUILT at execute/auto still exposes Edit/Write/Bash,
    // so when the user switches to Plan while the turn runs, deny them here at
    // permission time with the switch-to-planning instruction. A plan-BUILT
    // session never offers these tools, so this only fires on a mid-turn switch.
    if (currentTurnMode() === "plan" && PLAN_DENIED_TOOLS.has(toolName)) {
      return {
        behavior: "deny",
        message:
          "The user just switched this conversation to Plan mode, so you can no longer make changes or run commands. Stop acting now: summarize what you already did, then lay out the remaining work as a clear step-by-step plan in plain language for the user to approve, and end your turn.",
      };
    }
    // The SDK flags a call that reaches outside the allowed dirs via
    // `blockedPath`, so an escape our own parsing missed is still caught.
    const writes = toolName !== "Bash" && !isReadOnlyTool(toolName);
    try {
      if (options.blockedPath) {
        if (writes) guard.clampWrite(options.blockedPath);
        else guard.clamp(options.blockedPath);
      }
      if (isFileCall(toolName)) {
        const verdict = judgeFileCall(guard, toolName, input);
        if (verdict.behavior === "deny") return verdict;
        return {
          behavior: "allow",
          updatedInput: verdict.updatedInput ?? input,
        };
      }
      if (toolName === "Bash" && typeof input.command === "string")
        for (const p of bashEscapeCandidates(input.command)) guard.clamp(p);
      return { behavior: "allow", updatedInput: input };
    } catch (err) {
      return {
        behavior: "deny",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
