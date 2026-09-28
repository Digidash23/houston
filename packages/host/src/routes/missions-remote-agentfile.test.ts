import { expect, test } from "vitest";
import type { RemoteMissionRoute } from "./missions-remote";
import { readRemoteInstructions } from "./missions-remote-agentfile";

test("remote instructions use the exact agentfile path and the acting person", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const route: RemoteMissionRoute = {
    gateway: { url: "https://gw.test", token: "a".repeat(64) },
    target: {
      remote: true,
      id: "Personal/Writer",
      name: "Writer",
      workspace: "Personal",
      workspaceId: "personal",
      role: "Copywriter",
    },
    actingAs: "acting-v1.verified",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ content: "x".repeat(12_001) });
    }) as typeof fetch,
  };
  const profile = await readRemoteInstructions(route);
  expect(calls[0]?.url).toBe(
    "https://gw.test/agents/Personal%2FWriter/agentfile/CLAUDE.md",
  );
  expect(calls[0]?.init?.headers).toMatchObject({
    Authorization: `Bearer ${"a".repeat(64)}`,
    "x-houston-acting-as": "acting-v1.verified",
  });
  expect(profile).toMatchObject({
    ok: true,
    profile: {
      id: "Personal/Writer",
      name: "Writer",
      role: "Copywriter",
      truncated: true,
    },
  });
  if (!profile.ok) throw new Error("expected a profile");
  expect(profile.profile.instructions).toHaveLength(12_000);
});

test("remote instructions relay a gateway delegation refusal", async () => {
  const route: RemoteMissionRoute = {
    gateway: { url: "https://gw.test", token: "a".repeat(64) },
    target: {
      remote: true,
      id: "Personal/Writer",
      name: "Writer",
      workspace: "Personal",
      workspaceId: "personal",
    },
    fetchImpl: (async () =>
      Response.json(
        { code: "agent_not_allowed", error: "raw gateway text" },
        { status: 403 },
      )) as typeof fetch,
  };
  expect(await readRemoteInstructions(route)).toEqual({
    ok: false,
    status: 403,
    code: "agent_not_allowed",
    error:
      "You can only work with the AI Employees the user picked, and Writer isn't one of them. The user can change this in your settings under Teamwork.",
  });
});
