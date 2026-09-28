import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { docKey, loadActivities, saveActivities } from "@houston/domain";
import type { Activity, HoustonEvent } from "@houston/protocol";
import { beforeEach, expect, test, vi } from "vitest";
import type { ChannelCtx, RuntimeChannel } from "../ports";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import {
  delegationDocKey,
  readAgentDelegation,
  writeAgentDelegation,
} from "./agent-delegation-store";
import { rewriteOriginAgent } from "./agent-origin-rename";
import { dispatchGroup } from "./registry/all";

const card = (origin: string): Activity => ({
  id: "mission-1",
  title: "Research",
  description: "",
  status: "running",
  updated_at: "2026-01-01T00:00:00.000Z",
  origin_agent: origin,
});

const channel: RuntimeChannel = {
  async dispatch() {},
  async fireTurn() {},
  async cancelTurn() {
    return false;
  },
  async busy() {
    return false;
  },
  async teardown(_ctx: ChannelCtx) {},
  async captureCredential() {
    return { ok: true, provider: "anthropic" };
  },
  async forgetCredential() {},
  async saveApiKeyCredential() {},
  async saveClaudeOAuthCredential() {},
  async saveCustomEndpoint() {},
};

let store: MemoryWorkspaceStore;
let vfs: MemoryVfs;
let workspaceId: string;
let scoutId: string;
let writerId: string;
let writerRoot: string;

beforeEach(async () => {
  store = new MemoryWorkspaceStore();
  vfs = new MemoryVfs();
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  workspaceId = ws.id;
  scoutId = (await store.createAgent({ workspaceId, name: "Scout" })).id;
  writerId = (await store.createAgent({ workspaceId, name: "Writer" })).id;
  writerRoot = `ws/${workspaceId}/${writerId}/workspace`;
  await saveActivities(vfs, writerRoot, [card(scoutId)]);
  await writeAgentDelegation(vfs, workspaceId, scoutId, {
    mode: "picked",
    agents: [writerId],
    acceptsMissions: false,
  });
  await writeAgentDelegation(vfs, workspaceId, writerId, {
    mode: "picked",
    agents: [scoutId],
    acceptsMissions: true,
  });
});

function req(method: string, path: string, body: unknown) {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  return {
    method,
    path,
    url: new URL(path, "http://host.local"),
    req: Object.assign(stream, { headers: {} }) as IncomingMessage,
    userId: "alice",
    deps: { store, vfs, channels: { gke: channel } },
  };
}

function response() {
  const result = {
    status: 0,
    body: "",
    writeHead(status: number) {
      this.status = status;
      return this;
    },
    end(body?: unknown) {
      this.body = String(body ?? "");
      return this;
    },
  };
  return result as typeof result & ServerResponse;
}

test("rewrite changes provenance on every board and clears it on deletion", async () => {
  const ws = await store.getWorkspace(workspaceId);
  if (!ws) throw new Error("workspace missing");
  await rewriteOriginAgent(
    { store, vfs, channels: {} },
    ws,
    scoutId,
    "renamed",
  );
  expect((await loadActivities(vfs, writerRoot)).items[0]?.origin_agent).toBe(
    "renamed",
  );
  await rewriteOriginAgent(
    { store, vfs, channels: {} },
    ws,
    "renamed",
    undefined,
  );
  expect((await loadActivities(vfs, writerRoot)).items[0]).not.toHaveProperty(
    "origin_agent",
  );
});

test("provenance rewrite preserves unrelated raw board entries", async () => {
  await vfs.writeText(
    docKey(writerRoot, "activity"),
    JSON.stringify([card(scoutId), { future_field: true }]),
  );
  const ws = await store.getWorkspace(workspaceId);
  if (!ws) throw new Error("workspace missing");
  await rewriteOriginAgent(
    { store, vfs, channels: {} },
    ws,
    scoutId,
    "renamed",
  );
  const raw = await vfs.readText(docKey(writerRoot, "activity"));
  expect(JSON.parse(raw ?? "null")).toEqual([
    card("renamed"),
    { future_field: true },
  ]);
});

test("rename hook moves delegation and rewrites mission provenance", async () => {
  const movedId = `${workspaceId}/Researcher`;
  const original = store.renameAgent.bind(store);
  store.renameAgent = async (id, name) => ({
    ...(await original(id, name)),
    id: movedId,
  });
  const path = `/agents/${encodeURIComponent(scoutId)}`;
  const res = response();
  await dispatchGroup("agent-crud", {
    ...req("PATCH", path, { name: "Researcher" }),
    res,
  });
  expect(res.status).toBe(200);
  expect(await readAgentDelegation(vfs, workspaceId, movedId)).toMatchObject({
    mode: "picked",
    agents: [writerId],
    acceptsMissions: false,
  });
  expect(await readAgentDelegation(vfs, workspaceId, writerId)).toMatchObject({
    agents: [movedId],
  });
  expect((await loadActivities(vfs, writerRoot)).items[0]?.origin_agent).toBe(
    movedId,
  );
});

test("delete hook prunes delegation and clears mission provenance", async () => {
  const path = `/agents/${encodeURIComponent(scoutId)}`;
  const res = response();
  await dispatchGroup("agent-crud", { ...req("DELETE", path, {}), res });
  expect(res.status).toBe(200);
  expect(await readAgentDelegation(vfs, workspaceId, scoutId)).toMatchObject({
    mode: "all",
    agents: [],
    acceptsMissions: true,
  });
  expect(await readAgentDelegation(vfs, workspaceId, writerId)).toMatchObject({
    agents: [],
  });
  expect((await loadActivities(vfs, writerRoot)).items[0]).not.toHaveProperty(
    "origin_agent",
  );
});

test("a corrupt delegation document refuses rename before any board changes", async () => {
  const original = store.renameAgent.bind(store);
  store.renameAgent = async (id, name) => ({
    ...(await original(id, name)),
    id: "renamed-scout",
  });
  const clean = await store.createAgent({ workspaceId, name: "Editor" });
  const cleanRoot = `ws/${workspaceId}/${clean.id}/workspace`;
  await saveActivities(vfs, cleanRoot, [card(scoutId)]);
  await vfs.writeText(docKey(writerRoot, "activity"), "{broken");
  await vfs.writeText(delegationDocKey(workspaceId), "{broken");
  const events: HoustonEvent[] = [];
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const path = `/agents/${encodeURIComponent(scoutId)}`;
    const res = response();
    await expect(
      dispatchGroup("agent-crud", {
        ...req("PATCH", path, { name: "Researcher" }),
        deps: {
          store,
          vfs,
          channels: { gke: channel },
          events: {
            emit: (_userId, event) => {
              events.push(event);
            },
            subscribe: () => () => {},
          },
        },
        res,
      }),
    ).rejects.toThrow("corrupt document");
    expect(res.status).toBe(0);
    expect(events).toEqual([]);
    expect((await store.getAgent(scoutId))?.name).toBe("Scout");
    expect((await loadActivities(vfs, cleanRoot)).items[0]?.origin_agent).toBe(
      scoutId,
    );
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("corrupt document"),
      expect.any(Error),
    );
  } finally {
    report.mockRestore();
  }
});

test("a committed delete emits AgentsChanged and clears clean boards despite broken cleanup", async () => {
  const clean = await store.createAgent({ workspaceId, name: "Editor" });
  const cleanRoot = `ws/${workspaceId}/${clean.id}/workspace`;
  await saveActivities(vfs, cleanRoot, [card(scoutId)]);
  await vfs.writeText(docKey(writerRoot, "activity"), "{broken");
  await vfs.writeText(delegationDocKey(workspaceId), "{broken");
  const events: HoustonEvent[] = [];
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const path = `/agents/${encodeURIComponent(scoutId)}`;
    const res = response();
    await dispatchGroup("agent-crud", {
      ...req("DELETE", path, {}),
      deps: {
        store,
        vfs,
        channels: { gke: channel },
        events: {
          emit: (_userId, event) => {
            events.push(event);
          },
          subscribe: () => () => {},
        },
      },
      res,
    });
    expect(res.status).toBe(200);
    expect(await store.getAgent(scoutId)).toBeNull();
    expect(events).toContainEqual({ type: "AgentsChanged", workspaceId });
    expect((await loadActivities(vfs, cleanRoot)).items[0]).not.toHaveProperty(
      "origin_agent",
    );
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("delegation"),
      expect.any(Error),
    );
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("activity"),
      expect.any(Error),
    );
  } finally {
    report.mockRestore();
  }
});
