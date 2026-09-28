import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Agent, Workspace } from "../domain/types";
import { LocalPaths } from "../paths";
import type { WorkspaceStore } from "../ports";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import { writeAgentDelegation } from "./agent-delegation-store";
import { handleAgentDirectory, handleAgentProfile } from "./missions-agents";
import type { MissionsCtx } from "./missions-sandbox";

const paths = new LocalPaths();
let store: MemoryWorkspaceStore;
let vfs: MemoryVfs;
let ws: Workspace;
let caller: Agent;
let writer: Agent;
let researcher: Agent;
let ctx: MissionsCtx;

function response() {
  const captured: { status: number; body: unknown } = {
    status: 0,
    body: null,
  };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(chunk?: Buffer) {
      captured.body = chunk ? JSON.parse(chunk.toString("utf8")) : null;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

beforeEach(async () => {
  store = new MemoryWorkspaceStore({ defaultRuntime: "local" });
  vfs = new MemoryVfs();
  ws = await store.getOrCreatePersonalWorkspace("alice");
  caller = await store.createAgent({ workspaceId: ws.id, name: "Scout" });
  writer = await store.createAgent({ workspaceId: ws.id, name: "Writer" });
  researcher = await store.createAgent({
    workspaceId: ws.id,
    name: "Researcher",
  });
  const foreign = await store.getOrCreatePersonalWorkspace("bob");
  await store.createAgent({ workspaceId: foreign.id, name: "Foreign" });
  await vfs.writeText(
    `${paths.agentRoot(ws, writer)}/CLAUDE.md`,
    "---\nrole: Copywriter\n---\n\nWrite clearly.",
  );
  ctx = {
    deps: { store, vfs, paths, channels: {} },
    ws,
    agent: caller,
    vfs,
    paths,
    root: paths.agentRoot(ws, caller),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("lists other AI Employees in the caller's space with their roles", async () => {
  const { res, captured } = response();
  await handleAgentDirectory(ctx, res);
  expect(captured.status).toBe(200);
  expect(captured.body).toEqual({
    agents: [
      { id: writer.id, name: "Writer", role: "Copywriter", space: ws.name },
      { id: researcher.id, name: "Researcher", space: ws.name },
    ],
  });
});

test("a second workspace owned by the same person stays outside the directory", async () => {
  const second = { ...ws, id: "second", name: "Second" };
  const outsider = {
    ...writer,
    id: "outside",
    workspaceId: second.id,
    name: "Other",
  };
  const delegate = Object.create(store) as MemoryWorkspaceStore;
  delegate.listWorkspacesForUser = async (userId) => [
    ...(await store.listWorkspacesForUser(userId)),
    second,
  ];
  delegate.listAgents = async (id) =>
    id === second.id ? [outsider] : store.listAgents(id);
  const scoped: MissionsCtx = {
    ...ctx,
    deps: { ...ctx.deps, store: delegate as WorkspaceStore },
  };
  const { res, captured } = response();
  await handleAgentDirectory(scoped, res);
  expect(captured.status).toBe(200);
  expect(JSON.stringify(captured.body)).not.toContain("Other");
});

test("picked policy filters the list and off policy gives a named refusal", async () => {
  await writeAgentDelegation(vfs, ws.id, caller.id, {
    mode: "picked",
    agents: [writer.id],
    acceptsMissions: true,
  });
  const picked = response();
  await handleAgentDirectory(ctx, picked.res);
  expect(picked.captured.body).toEqual({
    agents: [
      { id: writer.id, name: "Writer", role: "Copywriter", space: ws.name },
    ],
  });
  await writeAgentDelegation(vfs, ws.id, caller.id, {
    mode: "off",
    agents: [],
    acceptsMissions: true,
  });
  const off = response();
  await handleAgentDirectory(ctx, off.res);
  expect(off.captured.status).toBe(403);
  expect(off.captured.body).toMatchObject({ code: "delegation_off" });
});

test("reads at most 12000 instruction characters and reports truncation", async () => {
  await vfs.writeText(
    `${paths.agentRoot(ws, writer)}/CLAUDE.md`,
    "x".repeat(12_005),
  );
  const { res, captured } = response();
  await handleAgentProfile(
    ctx,
    new URL("http://host/sandbox/missions/agents/read?agent=Writer"),
    res,
  );
  expect(captured.status).toBe(200);
  expect(captured.body).toMatchObject({
    id: writer.id,
    name: "Writer",
    instructions: "x".repeat(12_000),
    truncated: true,
  });
});

test("read relays the target resolver's policy refusal", async () => {
  await writeAgentDelegation(vfs, ws.id, caller.id, {
    mode: "picked",
    agents: [researcher.id],
    acceptsMissions: true,
  });
  const { res, captured } = response();
  await handleAgentProfile(
    ctx,
    new URL("http://host/sandbox/missions/agents/read?agent=Writer"),
    res,
  );
  expect(captured.status).toBe(403);
  expect(captured.body).toMatchObject({ code: "agent_not_allowed" });
});

test("read relays a gateway delegation refusal from the remote agentfile", async () => {
  vi.stubEnv("HOUSTON_INTEGRATIONS_URL", "https://gw.test");
  vi.stubEnv("HOUSTON_HOST_TOKEN", "a".repeat(64));
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/agents"))
      return Response.json([
        { id: "Remote/Writer", name: "Remote Writer", workspaceId: "remote" },
      ]);
    if (url.endsWith("/agentfile/CLAUDE.md"))
      return Response.json(
        { code: "not_assigned", error: "raw gateway text" },
        { status: 403 },
      );
    throw new Error(`unexpected gateway path: ${url}`);
  });
  const remoteCtx: MissionsCtx = {
    ...ctx,
    deps: { ...ctx.deps, gatewayFronted: true },
    actingAs: "acting-v1.verified",
  };
  const { res, captured } = response();
  await handleAgentProfile(
    remoteCtx,
    new URL("http://host/sandbox/missions/agents/read?agent=Remote%20Writer"),
    res,
  );
  expect(captured.status).toBe(403);
  expect(captured.body).toEqual({
    code: "not_assigned",
    error:
      "Remote Writer isn't available to the person you're working for. Ask the user to check access.",
  });
});
