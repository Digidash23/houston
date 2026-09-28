import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDelegation, HoustonEvent } from "@houston/protocol";
import { afterEach, beforeEach, expect, test } from "vitest";
import { LOCAL_CAPABILITIES } from "../capabilities";
import { MemoryCredentialStore } from "../credentials/store";
import type { EventHub } from "../events/hub";
import type { TokenVerifier, WorkspaceStore } from "../ports";
import { type ControlPlaneDeps, createControlPlaneServer } from "../server";
import { LocalWorkspaceStore } from "../store/local";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import {
  delegationDocKey,
  readAgentDelegation,
  writeAgentDelegation,
} from "./agent-delegation-store";

const verifier: TokenVerifier = {
  async verify(token) {
    return token.startsWith("tok:") ? { userId: token.slice(4) } : null;
  },
};
const headers = (user = "alice") => ({
  Authorization: `Bearer tok:${user}`,
  "Content-Type": "application/json",
});
const policy = (agents: string[] = []): AgentDelegation => ({
  mode: "picked",
  agents,
  acceptsMissions: true,
});

let server: Server;
let base: string;
let store: WorkspaceStore;
let vfs: MemoryVfs;
let events: { user: string; event: HoustonEvent }[];

beforeEach(async () => {
  store = new MemoryWorkspaceStore();
  vfs = new MemoryVfs();
  events = [];
  const hub: EventHub = {
    emit: (user, event) => events.push({ user, event }),
    subscribe: () => () => {},
  };
  const deps: ControlPlaneDeps = {
    verifier,
    store,
    credentials: new MemoryCredentialStore(),
    vault: { sandboxToken: () => "x", validateSandboxToken: () => null },
    channels: {},
    vfs,
    events: hub,
    capabilities: LOCAL_CAPABILITIES,
  };
  server = createControlPlaneServer(deps);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function create(name: string, user = "alice"): Promise<string> {
  const response = await fetch(`${base}/agents`, {
    method: "POST",
    headers: headers(user),
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function request(
  id: string,
  method: "GET" | "PUT",
  body?: unknown,
  user = "alice",
) {
  return fetch(`${base}/v1/agents/${encodeURIComponent(id)}/delegation`, {
    method,
    headers: headers(user),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("owner reads the default and a pruned view without changing storage", async () => {
  const scout = await create("Scout");
  const writer = await create("Writer");
  expect((await request(scout, "GET")).status).toBe(200);
  expect(await (await request(scout, "GET")).json()).toEqual({
    mode: "all",
    agents: [],
    acceptsMissions: true,
  });
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  await writeAgentDelegation(vfs, ws.id, scout, policy([writer, "gone"]));
  expect(await (await request(scout, "GET")).json()).toEqual(policy([writer]));
  expect(await vfs.readText(delegationDocKey(ws.id))).toContain("gone");
});

test("PUT stores a full policy and emits AgentsChanged for the owner", async () => {
  const scout = await create("Scout");
  const writer = await create("Writer");
  events = [];
  const response = await request(scout, "PUT", policy([writer, writer]));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(policy([writer]));
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  expect(events).toEqual([
    {
      user: "alice",
      event: {
        type: "AgentsChanged",
        workspaceId: ws.id,
      },
    },
  ]);
});

test("a paused PUT cannot leave a stale policy after its agent is renamed", async () => {
  const root = mkdtempSync(join(tmpdir(), "houston-put-rename-"));
  const local = new LocalWorkspaceStore(root, "alice");
  const localServer = createControlPlaneServer({
    verifier,
    store: local,
    credentials: new MemoryCredentialStore(),
    vault: { sandboxToken: () => "x", validateSandboxToken: () => null },
    channels: {},
    vfs,
    capabilities: LOCAL_CAPABILITIES,
  });
  await new Promise<void>((resolve) =>
    localServer.listen(0, "127.0.0.1", resolve),
  );
  const address = localServer.address();
  const localBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const workspace = await local.getOrCreatePersonalWorkspace("alice");
    const a = (
      await local.createAgent({ workspaceId: workspace.id, name: "A" })
    ).id;
    const originalList = local.listAgents.bind(local);
    let entered: (() => void) | undefined;
    let resume: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let held = false;
    local.listAgents = async (id) => {
      if (!held) {
        held = true;
        entered?.();
        await gate;
      }
      return originalList(id);
    };
    const put = fetch(
      `${localBase}/v1/agents/${encodeURIComponent(a)}/delegation`,
      {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          mode: "off",
          agents: [],
          acceptsMissions: false,
        }),
      },
    );
    await paused;
    const rename = fetch(`${localBase}/agents/${encodeURIComponent(a)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ name: "B" }),
    });
    await Promise.race([
      rename,
      new Promise((resolve) => setTimeout(resolve, 30)),
    ]);
    resume?.();
    expect((await put).status).toBe(200);
    expect((await rename).status).toBe(200);
    const b = `${workspace.id}/B`;
    expect(await readAgentDelegation(vfs, workspace.id, b)).toMatchObject({
      mode: "off",
    });
    expect(
      (await vfs.readText(delegationDocKey(workspace.id))) ?? "",
    ).not.toContain(`"${a}"`);
  } finally {
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("PUT recovers a corrupt document and keeps every other addressable agent closed", async () => {
  const scout = await create("Scout");
  const writer = await create("Writer");
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  await vfs.writeText(delegationDocKey(ws.id), "{broken");
  const response = await request(scout, "PUT", policy([writer]));
  expect(response.status).toBe(200);
  expect(await (await request(writer, "GET")).json()).toEqual({
    mode: "off",
    agents: [],
    acceptsMissions: false,
  });
  expect(await (await request(scout, "GET")).json()).toEqual(policy([writer]));
  expect(
    (await vfs.list(ws.id)).some((key) =>
      key.includes(".agent-delegation.corrupt-"),
    ),
  ).toBe(true);
});

test("owner and input refusals use the pinned codes", async () => {
  const scout = await create("Scout");
  const bob = await create("Bob", "bob");
  const cases: { body: unknown; code: string }[] = [
    { body: { ...policy(), mode: "unknown" }, code: "invalid_delegation_mode" },
    {
      body: { ...policy(), agents: [scout] },
      code: "invalid_delegation_agents",
    },
    {
      body: {
        ...policy(),
        agents: Array.from({ length: 201 }, (_, i) => `a${i}`),
      },
      code: "too_many_agents",
    },
    { body: policy([bob]), code: "unknown_agent" },
  ];
  for (const { body, code } of cases) {
    const response = await request(scout, "PUT", body);
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({ code });
  }
  const originalList = store.listAgents.bind(store);
  store.listAgents = async (workspaceId) => [
    ...(await originalList(workspaceId)),
    { id: "hidden-agent", workspaceId, name: ".hidden", createdAt: 0 },
  ];
  const hidden = await request(scout, "PUT", policy(["hidden-agent"]));
  expect(hidden.status).toBe(400);
  expect(await hidden.json()).toMatchObject({
    code: "unknown_agent",
    agents: ["hidden-agent"],
  });
  const foreign = await request(bob, "PUT", policy(), "alice");
  expect(foreign.status).toBe(403);
  expect(await foreign.json()).toMatchObject({ code: "not_manager" });
  const missing = await request("missing", "PUT", policy());
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ code: "agent_not_found" });
});
