import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { makeAgentDirectoryTools } from "./agent-directory";
import type { SandboxFetch } from "./sandbox-fetch";

const NOOP = {} as ExtensionContext;

function transport(status: number, body: unknown) {
  const paths: string[] = [];
  const call: SandboxFetch = async (path) => {
    paths.push(path);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { paths, tools: makeAgentDirectoryTools({ call }) };
}

test("lists the reachable AI Employees through the mission sandbox", async () => {
  const { paths, tools } = transport(200, {
    agents: [{ id: "writer", name: "Writer", role: "Copy", space: "Personal" }],
  });
  const result = await tools[0]?.execute(
    "call-1",
    {},
    undefined,
    undefined,
    NOOP,
  );
  expect(paths).toEqual(["/sandbox/missions/agents"]);
  expect(result?.details).toEqual({ ok: true, count: 1 });
  expect(result?.content[0]).toMatchObject({
    text: JSON.stringify([
      { id: "writer", name: "Writer", role: "Copy", space: "Personal" },
    ]),
  });
});

test("reads instructions by encoded agent reference", async () => {
  const profile = {
    id: "writer",
    name: "Writer",
    instructions: "Write clearly",
    truncated: false,
  };
  const { paths, tools } = transport(200, profile);
  const result = await tools[1]?.execute(
    "call-2",
    { agent: "Personal/Writer" },
    undefined,
    undefined,
    NOOP,
  );
  expect(paths).toEqual([
    "/sandbox/missions/agents/read?agent=Personal%2FWriter",
  ]);
  expect(result?.details).toEqual({ ok: true, id: "writer", truncated: false });
  expect(result?.content[0]).toMatchObject({ text: JSON.stringify(profile) });
});

test("policy refusals retain their code and agent-facing sentence", async () => {
  const { tools } = transport(403, {
    code: "delegation_off",
    error: "The user can turn this on under Teamwork.",
  });
  const result = await tools[0]?.execute(
    "call-3",
    {},
    undefined,
    undefined,
    NOOP,
  );
  expect(result?.details).toEqual({
    ok: false,
    error: {
      code: "delegation_off",
      message: "The user can turn this on under Teamwork.",
      status: 403,
    },
  });
});
