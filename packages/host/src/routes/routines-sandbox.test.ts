import type { IncomingMessage, ServerResponse } from "node:http";
import { loadRoutines, saveActivities, saveRoutines } from "@houston/domain";
import type {
  Activity,
  HoustonEvent,
  Routine,
  TurnLimits,
} from "@houston/protocol";
import { beforeEach, expect, test } from "vitest";
import type { Agent, Workspace } from "../domain/types";
import { LocalPaths } from "../paths";
import type { CredentialVault } from "../ports";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import { CONVERSATION_ID_HEADER } from "./learnings-sandbox";
import { type LiveTurnPin, liveTurns } from "./live-turn";
import { handleSandboxRoutines } from "./routines-sandbox";

/**
 * The agent's `save_routine` write route. Under test here: WHICH PROVIDER a
 * routine the agent creates ends up running on (PRODUCT-1842).
 *
 * The agent never names a provider (its tool schema has none), so every routine
 * it saved was unpinned and fired on the runtime's last-used provider - a local
 * model the user had picked once and never connected, while the chat that
 * authored the routine ran on Claude. A new routine now inherits the pair the
 * authoring turn was sent with (recorded on the live turn by the host, never
 * taken from the runtime's own word); an explicit pin and an update are left
 * alone, and a save with no recorded turn stays unpinned as before.
 */

const paths = new LocalPaths();

let store: MemoryWorkspaceStore;
let vfs: MemoryVfs;
let ws: Workspace;
let agent: Agent;
let root: string;
let events: HoustonEvent[];

const vault: CredentialVault = {
  sandboxToken: () => "sb",
  validateSandboxToken: (token) =>
    token === "sb-good" ? { workspaceId: ws.id, agentId: agent.id } : null,
};

function fakeReq(
  body: unknown,
  headers: Record<string, string>,
): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body));
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      if (buf.byteLength) yield buf;
    },
  } as unknown as IncomingMessage;
}

function fakeRes() {
  const captured: { status: number; body: unknown } = { status: 0, body: null };
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

const BASE = {
  name: "Inbox digest",
  prompt: "Summarize every new email.",
  schedule: "0 9 * * *",
};

async function save(
  body: Record<string, unknown>,
  opts: {
    /** The pair the send that started the authoring turn asked for. */
    pin?: LiveTurnPin;
    /** Call as a runtime with no turn of the host's running behind it. */
    noLiveTurn?: boolean;
    conversationId?: string;
    actingAs?: string;
    spoofedActingAs?: string;
    gatewayFronted?: boolean;
    triggersEnabled?: boolean;
    /** The plan limits the host recorded on the authoring turn. */
    limits?: TurnLimits;
  } = {},
) {
  const headers: Record<string, string> = {
    authorization: "Bearer sb-good",
    [CONVERSATION_ID_HEADER]: opts.conversationId ?? "activity-1",
  };
  if (opts.spoofedActingAs)
    headers["x-houston-acting-as"] = opts.spoofedActingAs;
  liveTurns.forget(agent.id);
  if (!opts.noLiveTurn)
    liveTurns.start(
      agent.id,
      opts.conversationId ?? "activity-1",
      "execute",
      { actingAs: opts.actingAs, limits: opts.limits },
      opts.pin,
    );
  const { res, captured } = fakeRes();
  const handled = await handleSandboxRoutines(
    {
      vault,
      store,
      vfs,
      paths,
      gatewayFronted: opts.gatewayFronted,
      triggersEnabled: opts.triggersEnabled,
      events: {
        emit: (_userId: string, event: HoustonEvent) => events.push(event),
      } as never,
    },
    "POST",
    "/sandbox/routines/save",
    new URL("http://host/sandbox/routines/save"),
    fakeReq(body, headers),
    res,
  );
  return { handled, ...captured };
}

const REFUSAL =
  "A mission another AI Employee gave you can't set up routines. Finish the mission, or ask the user to set this up from a chat.";

function actingToken(dlg?: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: "alice", ...(dlg ? { dlg } : {}) }),
  ).toString("base64url");
  return `acting-v1.${payload}.signature`;
}

const TRIGGER = {
  toolkit: "gmail",
  trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
  trigger_config: {},
};

test.each([
  ["schedule", BASE],
  ["event trigger", { ...BASE, schedule: undefined, trigger: TRIGGER }],
])("a delegated gateway turn cannot create a %s routine", async (_kind, body) => {
  const r = await save(body, {
    gatewayFronted: true,
    triggersEnabled: true,
    actingAs: actingToken("delegator"),
  });
  expect(r).toMatchObject({
    status: 409,
    body: { code: "mission_depth", error: REFUSAL },
  });
  expect(await onDisk()).toEqual([]);
  expect(events).toEqual([]);
});

test.each([
  ["schedule", { prompt: "Changed" }],
  ["event trigger", { schedule: null, trigger: TRIGGER }],
])("a delegated gateway turn cannot update a %s routine", async (_kind, update) => {
  const created = await save(BASE);
  const original = await onDisk();
  events = [];
  const r = await save(
    { id: (created.body as Routine).id, ...update },
    {
      gatewayFronted: true,
      triggersEnabled: true,
      actingAs: actingToken("delegator"),
    },
  );
  expect(r).toMatchObject({
    status: 409,
    body: { code: "mission_depth", error: REFUSAL },
  });
  expect(await onDisk()).toEqual(original);
  expect(events).toEqual([]);
});

test("a local delegated mission cannot create or update a routine", async () => {
  const created = await save(BASE);
  const original = await onDisk();
  events = [];
  const mission: Activity = {
    id: "child",
    title: "Delegated",
    description: "",
    status: "running",
    session_key: "conv-child",
    origin_session_key: "conv-parent",
  };
  await saveActivities(vfs, root, [mission]);
  for (const body of [
    BASE,
    { id: (created.body as Routine).id, prompt: "Changed" },
  ]) {
    const r = await save(body, { conversationId: "conv-child" });
    expect(r).toMatchObject({
      status: 409,
      body: { code: "mission_depth", error: REFUSAL },
    });
  }
  expect(await onDisk()).toEqual(original);
  expect(events).toEqual([]);
});

test("an ordinary chat and a human-started mission may save routines", async () => {
  const chat = await save(BASE, {
    gatewayFronted: true,
    actingAs: actingToken(),
  });
  expect(chat.status).toBe(201);
  await saveActivities(vfs, root, [
    {
      id: "human",
      title: "Human mission",
      description: "",
      status: "running",
      session_key: "conv-human",
    },
  ]);
  const mission = await save(
    { ...BASE, name: "Another" },
    { conversationId: "conv-human" },
  );
  expect(mission.status).toBe(201);
  expect(await onDisk()).toHaveLength(2);
});

test("a delegated mission may pause an existing routine", async () => {
  const created = await save(BASE);
  await saveActivities(vfs, root, [
    {
      id: "child",
      title: "Delegated",
      description: "",
      status: "running",
      session_key: "conv-child",
      origin_session_key: "conv-parent",
    },
  ]);
  const r = await save(
    { id: (created.body as Routine).id, enabled: false },
    {
      conversationId: "conv-child",
    },
  );
  expect(r.status).toBe(200);
  expect((await onDisk())[0]?.enabled).toBe(false);
});

async function onDisk(): Promise<Routine[]> {
  return (await loadRoutines(vfs, root)).items;
}

beforeEach(async () => {
  store = new MemoryWorkspaceStore({ defaultRuntime: "local" });
  vfs = new MemoryVfs();
  events = [];
  ws = await store.getOrCreatePersonalWorkspace("alice");
  agent = await store.createAgent({ workspaceId: ws.id, name: "Test" });
  root = paths.agentRoot(ws, agent);
});

test("a new routine runs on the pair the authoring chat runs on", async () => {
  const r = await save(BASE, {
    pin: { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
  });
  expect(r.status).toBe(201);
  const [routine] = await onDisk();
  expect(routine).toMatchObject({
    provider: "anthropic",
    model: "claude-sonnet-5",
    effort: "medium",
  });
  expect(events).toEqual([{ type: "RoutinesChanged", agentPath: agent.id }]);
});

test("the stamped provider is stored in pi's canonical dialect", async () => {
  // The composer speaks display ids: "openai" is Codex on the wire.
  await save(BASE, { pin: { provider: "openai", model: "gpt-5.5" } });
  expect((await onDisk())[0]).toMatchObject({
    provider: "openai-codex",
    model: "gpt-5.5",
  });
});

test("a provider the agent named explicitly is kept", async () => {
  await save(
    { ...BASE, provider: "google", model: "gemini-3.5-pro" },
    { pin: { provider: "anthropic", model: "claude-sonnet-5" } },
  );
  expect((await onDisk())[0]).toMatchObject({
    provider: "google",
    model: "gemini-3.5-pro",
    effort: null,
  });
});

test("a send that pinned no provider leaves the routine unpinned", async () => {
  await save(BASE);
  expect((await onDisk())[0]).toMatchObject({
    provider: null,
    model: null,
    effort: null,
  });
});

test("a save with no recorded turn behind it stays unpinned", async () => {
  const r = await save(BASE, { noLiveTurn: true });
  expect(r.status).toBe(201);
  expect((await onDisk())[0]?.provider).toBeNull();
});

test("an update never re-pins: a routine that follows the agent keeps following it", async () => {
  const created = await save(BASE);
  const id = (created.body as Routine).id;
  await saveRoutines(vfs, root, await onDisk());
  const r = await save(
    { id, prompt: "Summarize only unread email." },
    { pin: { provider: "anthropic", model: "claude-sonnet-5" } },
  );
  expect(r.status).toBe(200);
  const [routine] = await onDisk();
  expect(routine?.prompt).toBe("Summarize only unread email.");
  expect(routine?.provider).toBeNull();
});

test("a turn under a plan floor cannot save a routine that fires more often", async () => {
  const r = await save(
    { ...BASE, schedule: "*/5 * * * *" },
    {
      gatewayFronted: true,
      actingAs: actingToken(),
      limits: { routineMinIntervalMinutes: 15 },
    },
  );
  expect(r).toMatchObject({
    status: 400,
    body: {
      code: "plan_min_interval",
      minIntervalMinutes: 15,
      error: expect.stringContaining("at most once every 15 minutes"),
    },
  });
  expect(await onDisk()).toEqual([]);
  expect(events).toEqual([]);
});

test("the same turn may save at the floor, and an update is held to it too", async () => {
  const opts = {
    gatewayFronted: true,
    actingAs: actingToken(),
    limits: { routineMinIntervalMinutes: 15 },
  };
  const created = await save({ ...BASE, schedule: "*/15 * * * *" }, opts);
  expect(created.status).toBe(201);
  const id = (created.body as Routine).id;
  const tightened = await save({ id, schedule: "*/5 * * * *" }, opts);
  expect(tightened).toMatchObject({
    status: 400,
    body: { code: "plan_min_interval" },
  });
  expect((await onDisk())[0]?.schedule).toBe("*/15 * * * *");
});

test("a turn with no recorded limits keeps any cadence", async () => {
  const r = await save(
    { ...BASE, schedule: "*/5 * * * *" },
    { gatewayFronted: true, actingAs: actingToken() },
  );
  expect(r.status).toBe(201);
});
