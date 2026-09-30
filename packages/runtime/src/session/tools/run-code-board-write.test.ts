import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { makeRunCodeTool } from "./run-code";
import { RunCodeLimiter } from "./run-code-limiter";

test("run_code refuses a declared board input artifact and preserves the board", async () => {
  const ws = await mkdtemp(join(tmpdir(), "run-code-board-"));
  const boardPath = ".houston/activity/activity.json";
  await mkdir(join(ws, ".houston", "activity"), { recursive: true });
  await writeFile(join(ws, boardPath), "original board");
  const tool = makeRunCodeTool({
    workspaceDir: ws,
    limiter: new RunCodeLimiter({ maxConcurrent: 1, maxPerMinute: 10 }),
    transport: async () =>
      Response.json({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
        artifacts: [
          {
            path: boardPath,
            contentBase64: Buffer.from("rewritten board").toString("base64"),
          },
          {
            path: "result.txt",
            contentBase64: Buffer.from("safe output").toString("base64"),
          },
        ],
      }),
  });

  const result = await tool.execute(
    "board",
    { language: "python", code: "x", input_files: [boardPath] },
    undefined,
    undefined,
    {} as unknown as ExtensionToolContext,
  );

  expect(await readFile(join(ws, boardPath), "utf8")).toBe("original board");
  expect(await readFile(join(ws, "result.txt"), "utf8")).toBe("safe output");
  expect(result.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining(
      "Your board is changed with the mission tools, not by editing files.",
    ),
  });
});

test("run_code refuses a declared routines input artifact and preserves the routines", async () => {
  const ws = await mkdtemp(join(tmpdir(), "run-code-routines-"));
  const path = ".houston/routines/routines.json";
  await mkdir(join(ws, ".houston", "routines"), { recursive: true });
  await writeFile(join(ws, path), "original routines");
  const tool = makeRunCodeTool({
    workspaceDir: ws,
    limiter: new RunCodeLimiter({ maxConcurrent: 1, maxPerMinute: 10 }),
    transport: async () =>
      Response.json({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
        artifacts: [
          {
            path,
            contentBase64: Buffer.from("rewritten routines").toString("base64"),
          },
        ],
      }),
  });

  const result = await tool.execute(
    "routines",
    { language: "python", code: "x", input_files: [path] },
    undefined,
    undefined,
    {} as unknown as ExtensionToolContext,
  );

  expect(await readFile(join(ws, path), "utf8")).toBe("original routines");
  expect(result.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining(
      "Routines are changed with the routine tools, not by editing files.",
    ),
  });
});
