import { Type } from "typebox";
import { expect, test } from "vitest";
import { adaptTool, type BridgedPiTool } from "./mcp-tool-adapter";

function tool(details: unknown): BridgedPiTool {
  return {
    name: "start_mission",
    description: "Start a mission",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: "An unrelated reply" }],
      details,
    }),
  };
}

test("the MCP bridge returns mission details as structured content", async () => {
  const mission = { id: "m1", title: "Research", agent: "Ada" };
  const result = await adaptTool(tool({ ok: true, ...mission })).handler(
    {},
    {},
  );
  expect(result.structuredContent).toEqual({ mission });
});

test("a refused mission has no structured receipt", async () => {
  const result = await adaptTool(tool({ ok: false })).handler({}, {});
  expect(result.structuredContent).toBeUndefined();
});

test("an operation the tool reports as not done reaches Claude as an error", async () => {
  const call = (details: unknown): BridgedPiTool => ({
    name: "houston_call",
    description: "Do it in Houston",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: "ERROR needs_confirmation: ask" }],
      details,
    }),
  });
  expect((await adaptTool(call({ ok: false })).handler({}, {})).isError).toBe(
    true,
  );
  expect(
    (await adaptTool(call({ ok: true })).handler({}, {})).isError,
  ).toBeUndefined();
});
