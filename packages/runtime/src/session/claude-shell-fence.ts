import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIAL_ENV_VARS } from "../backends/claude/credential-env-vars";
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
 * `CLAUDE_CODE_SHELL_PREFIX` names it (`claudeShellPrefix`): the CLI appends
 * the whole command as ONE argument (verified against Claude Code 2.1), after
 * the `-c` the dash form of the prefix adds, so `$1` is the command once any
 * `-c` is shifted off, and the wrapper re-enters bash under the cap. `$BASH` is the interpreter running
 * this script (always set inside a bash script), the same one the CLI chose.
 *
 * With a tool shell (config.toolShell) the wrapper hands the command to it
 * instead, so it runs as the deployment's tool user; the cap line, when there
 * is a cap, still runs first and the tool shell inherits it.
 *
 * Either way the CLI's credential variables are unset first: on Linux the
 * CLI's own scrub is off (backends/claude/claude-env.ts), and the tool shell
 * keeps the environment it is handed.
 */
export function claudeShellFenceScript(
  capBytes: number | null,
  toolShell: string | null = null,
): string {
  return [
    "#!/bin/bash",
    "# Written by the Houston runtime (session/child-memory-fence.ts).",
    toolShell !== null
      ? "# Runs the Claude CLI's shell commands as the deployment's tool user."
      : capBytes !== null
        ? "# Runs the Claude CLI's shell commands under a per-process memory cap."
        : "# Runs the Claude CLI's shell commands without its credentials.",
    'if [ "$1" = "-c" ]; then shift; fi',
    ...(capBytes === null ? [] : [bashMemoryFencePrefix(capBytes)]),
    `unset ${CREDENTIAL_ENV_VARS.join(" ")}`,
    toolShell === null
      ? 'exec "$BASH" -c "$1"'
      : `exec ${shellWord(toolShell)} -c "$1"`,
    "",
  ].join("\n");
}

/**
 * The `CLAUDE_CODE_SHELL_PREFIX` value for the wrapper at `fencePath`. Claude
 * Code splits the prefix at its LAST " -" into an executable it shell-quotes
 * and raw arguments, so a bare path containing " -" (an agent folder named
 * "Writer - Draft") would run the wrong file; a trailing `-c` becomes that
 * last " -" and keeps the path one quoted word. Any other path stays bare:
 * the CLI also spawns stdio MCP servers (machine-managed ones included) with
 * this value as the executable, unsplit, which the `-c` form cannot serve.
 */
export function claudeShellPrefix(fencePath: string): string {
  return fencePath.includes(" -") ? `${fencePath} -c` : fencePath;
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
 * tool shell, written into the runtime's data dir on first use. Linux always
 * gets one, since it is what unsets the credential variables there. Elsewhere
 * it is null when there is neither a cap nor a tool shell.
 */
export function claudeShellFencePath(
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (resolvedFencePath === undefined) {
    const cap = resolveChildMemoryCap();
    resolvedFencePath =
      cap === null && config.toolShell === null && platform !== "linux"
        ? null
        : ensureClaudeShellFence(
            join(config.dataDir, "bin"),
            cap,
            config.toolShell,
          );
  }
  return resolvedFencePath;
}
