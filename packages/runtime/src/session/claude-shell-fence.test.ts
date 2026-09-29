import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  claudeShellFenceScript,
  ensureClaudeShellFence,
} from "./claude-shell-fence";

/**
 * The script the Claude CLI's Bash tool runs every command through
 * (`CLAUDE_CODE_SHELL_PREFIX`). It caps memory inside a memory-limited
 * container, and on a deployment with a tool shell it is also what drops the
 * command to the unprivileged tool user, so there it exists even with no cap.
 */

const MiB = 1024 * 1024;
const TOOL_SHELL = "/opt/worker/tool-shell";

const dirs: string[] = [];
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const priorEnv = {
  HOUSTON_TOOL_SHELL: process.env.HOUSTON_TOOL_SHELL,
  HOUSTON_DATA_DIR: process.env.HOUSTON_DATA_DIR,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("without a tool shell", () => {
  test("the wrapper is byte-identical to the memory fence it always was", () => {
    expect(claudeShellFenceScript(768 * MiB)).toBe(
      [
        "#!/bin/bash",
        "# Written by the Houston runtime (session/child-memory-fence.ts).",
        "# Runs the Claude CLI's shell commands under a per-process memory cap.",
        "ulimit -d 786432 2>/dev/null",
        'exec "$BASH" -c "$1"',
        "",
      ].join("\n"),
    );
  });

  test("writes an executable wrapper and rewrites it for a new cap", () => {
    const dir = join(scratch("fence-"), "bin");

    const path = ensureClaudeShellFence(dir, 768 * MiB);
    expect(path).toBe(join(dir, "claude-shell-fence"));
    expect(readFileSync(path, "utf8")).toBe(claudeShellFenceScript(768 * MiB));
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o111).toBe(0o111);

    expect(ensureClaudeShellFence(dir, 512 * MiB)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(claudeShellFenceScript(512 * MiB));
  });
});

describe("with a tool shell", () => {
  test("the cap runs first, then the command goes to the tool shell", () => {
    const script = claudeShellFenceScript(768 * MiB, TOOL_SHELL);
    expect(script.startsWith("#!/bin/bash\n")).toBe(true);
    expect(script).toContain("ulimit -d 786432 2>/dev/null\n");
    expect(script.endsWith(`exec '${TOOL_SHELL}' -c "$1"\n`)).toBe(true);
    expect(script).not.toContain("$BASH");
  });

  test("with no cap there is no ulimit line, only the tool shell", () => {
    const script = claudeShellFenceScript(null, TOOL_SHELL);
    expect(script).not.toContain("ulimit");
    expect(script.endsWith(`exec '${TOOL_SHELL}' -c "$1"\n`)).toBe(true);
  });

  // Runs the real script: the command must reach the tool shell as ONE
  // argument after `-c`, however the tool shell's path is spelled.
  test.skipIf(process.platform === "win32")(
    "the command reaches the tool shell intact, even from an awkward path",
    () => {
      const root = scratch("fence tool's shell-");
      const toolShell = join(root, "tool shell's wrapper");
      writeFileSync(
        toolShell,
        '#!/bin/bash\n[ "$1" = "-c" ] || exit 64\necho "via tool shell"\nexec /bin/bash -c "$2"\n',
      );
      chmodSync(toolShell, 0o755);
      const fence = ensureClaudeShellFence(join(root, "bin"), null, toolShell);

      const out = execFileSync(
        "/bin/bash",
        [fence, "echo \"$((6 * 7))\" 'a b'"],
        {
          encoding: "utf8",
        },
      );
      expect(out).toBe("via tool shell\n42 a b\n");
    },
  );

  test("the runtime writes the wrapper even with no memory cap", async () => {
    process.env.HOUSTON_TOOL_SHELL = TOOL_SHELL;
    process.env.HOUSTON_DATA_DIR = scratch("fence-data-");
    vi.resetModules();
    vi.doMock("./child-memory-fence", async (actual) => ({
      ...(await actual<typeof import("./child-memory-fence")>()),
      resolveChildMemoryCap: () => null,
    }));
    try {
      const { claudeShellFencePath } = await import("./claude-shell-fence");
      const path = claudeShellFencePath();
      expect(path).toBe(
        join(process.env.HOUSTON_DATA_DIR, "bin", "claude-shell-fence"),
      );
      expect(readFileSync(path ?? "", "utf8")).toBe(
        claudeShellFenceScript(null, TOOL_SHELL),
      );
    } finally {
      vi.doUnmock("./child-memory-fence");
      vi.resetModules();
    }
  });

  test("with neither a cap nor a tool shell there is no wrapper", async () => {
    delete process.env.HOUSTON_TOOL_SHELL;
    process.env.HOUSTON_DATA_DIR = scratch("fence-data-");
    vi.resetModules();
    vi.doMock("./child-memory-fence", async (actual) => ({
      ...(await actual<typeof import("./child-memory-fence")>()),
      resolveChildMemoryCap: () => null,
    }));
    try {
      const { claudeShellFencePath } = await import("./claude-shell-fence");
      expect(claudeShellFencePath()).toBeNull();
    } finally {
      vi.doUnmock("./child-memory-fence");
      vi.resetModules();
    }
  });
});
