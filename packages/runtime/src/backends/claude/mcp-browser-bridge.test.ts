import { expect, test } from "vitest";
import { adaptTool, type BridgedPiTool } from "./mcp-tool-adapter";
import { buildBridgedToolSet } from "./mcp-tool-set";

const browser = { workspaceDir: "/ws/Agent" };
const names = (tools: BridgedPiTool[]) => tools.map((t) => t.name);

test("the long-lived Claude path bridges the browser for execute and auto", () => {
  for (const mode of [undefined, "execute", "auto"] as const)
    expect(names(buildBridgedToolSet({ browser, mode }))).toContain("browser");
});

test("plan and the coordinator never get the browser on the Claude path", () => {
  expect(names(buildBridgedToolSet({ browser, mode: "plan" }))).not.toContain(
    "browser",
  );
  expect(
    names(buildBridgedToolSet({ browser, personalAssistant: true })),
  ).not.toContain("browser");
  expect(names(buildBridgedToolSet({}))).not.toContain("browser");
});

test("a screenshot reaches Claude as an image, not a JSON string", async () => {
  const tool: BridgedPiTool = {
    name: "browser",
    description: "d",
    parameters: buildBridgedToolSet({ browser }).find(
      (t) => t.name === "browser",
    )?.parameters as BridgedPiTool["parameters"],
    execute: async () => ({
      content: [
        { type: "text", text: "Screenshot." },
        { type: "image", data: "AAAA", mimeType: "image/jpeg" },
      ],
      details: { ok: true },
    }),
  };
  const result = await adaptTool(tool).handler({ action: "screenshot" }, {});
  expect(result.content).toEqual([
    { type: "text", text: "Screenshot." },
    { type: "image", data: "AAAA", mimeType: "image/jpeg" },
  ]);
});
