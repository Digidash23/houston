import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import {
  bashMemoryFencePrefix,
  resolveChildMemoryCap,
} from "./child-memory-fence";

/** `value` as one single-quoted shell word. */
function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The wrapper the Claude CLI runs its Bash tool through when
 * `CLAUDE_CODE_SHELL_PREFIX` names it: the CLI appends the whole command as
 * ONE argument (verified against Claude Code 2.1), so `$1` is the command and
 * the wrapper re-enters bash under the cap. `$BASH` is the interpreter running
 * this script (always set inside a bash script), the same one the CLI chose.
 *
 * With a tool shell (config.toolShell) the wrapper hands the command to it
 * instead, so it runs as the deployment's tool user; the cap line, when there
 * is a cap, still runs first and the tool shell inherits it.
 */
export function claudeShellFenceScript(
  capBytes: number | null,
  toolShell: string | null = null,
): string {
  // The header still names child-memory-fence.ts, where this lived: without a
  // tool shell the script must stay byte-identical to what it always was.
  return [
    "#!/bin/bash",
    "# Written by the Houston runtime (session/child-memory-fence.ts).",
    toolShell === null
      ? "# Runs the Claude CLI's shell commands under a per-process memory cap."
      : "# Runs the Claude CLI's shell commands as the deployment's tool user.",
    ...(capBytes === null ? [] : [bashMemoryFencePrefix(capBytes)]),
    toolShell === null
      ? 'exec "$BASH" -c "$1"'
      : `exec ${shellWord(toolShell)} -c "$1"`,
    "",
  ].join("\n");
}

/**
 * Write the wrapper under `dir` and return its absolute path. Rewritten on
 * every call (cheap, and a cap change must never leave a stale script
 * behind); mode 0755 so the CLI's shell can execute it. `dir` must stay
 * unwritable by a tool user: the CLI runs this file as the runtime's user.
 */
export function ensureClaudeShellFence(
  dir: string,
  capBytes: number | null,
  toolShell: string | null = null,
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "claude-shell-fence");
  writeFileSync(path, claudeShellFenceScript(capBytes, toolShell), "utf8");
  chmodSync(path, 0o755);
  return path;
}

let resolvedFencePath: string | null | undefined;

/**
 * The absolute path of the Claude CLI shell wrapper for this runtime's cap and
 * tool shell, written into the runtime's data dir on first use. Null when
 * there is neither a cap nor a tool shell.
 */
export function claudeShellFencePath(): string | null {
  if (resolvedFencePath === undefined) {
    const cap = resolveChildMemoryCap();
    resolvedFencePath =
      cap === null && config.toolShell === null
        ? null
        : ensureClaudeShellFence(
            join(config.dataDir, "bin"),
            cap,
            config.toolShell,
          );
  }
  return resolvedFencePath;
}
