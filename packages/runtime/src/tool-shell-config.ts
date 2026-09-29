import { isAbsolute } from "node:path";

/**
 * Parse `HOUSTON_TOOL_SHELL`: the deployment's wrapper that runs
 * `-c <command>` as an unprivileged tool user (the E2B pool-worker template
 * ships `/opt/worker/tool-shell`). Unset or blank means no wrapper: model
 * commands run as this process's own user, as on the desktop, self-host and
 * standing pods.
 *
 * A relative path throws: it would resolve against whatever cwd a command
 * runs in (the agent's workspace, which the model writes), so the model
 * could substitute its own "wrapper" and run as the runtime's user again.
 */
export function parseToolShell(raw: string | undefined): string | null {
  const path = raw?.trim() ?? "";
  if (path === "") return null;
  if (!isAbsolute(path))
    throw new Error(
      `HOUSTON_TOOL_SHELL must be an absolute path, got "${path}"`,
    );
  return path;
}
