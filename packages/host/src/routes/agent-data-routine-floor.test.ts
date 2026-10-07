import type { Server } from "node:http";
import {
  parsePlanMinIntervalRefusal,
  ROUTINE_FLOOR_HEADER,
  type Routine,
} from "@houston/protocol";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ProxyChannel } from "../channel/proxy";
import { MemoryCredentialStore } from "../credentials/store";
import type { RuntimeEndpoint, RuntimeLauncher, TokenVerifier } from "../ports";
import { type ControlPlaneDeps, createControlPlaneServer } from "../server";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";

/**
 * The plan floor on the app's and the AI Manager's routine writes (`POST
 * /agents/:id/routines`, `PATCH /agents/:id/routines/:rid`). The gateway
 * stamps `x-houston-routine-floor` for a person on a plan with a floor and
 * strips any client copy; the host trusts it only behind the gateway, and
 * refuses a save under it with the same `400 plan_min_interval` an agent's
 * own save gets.
 */

const verifier: TokenVerifier = {
  async verify(bearer) {
    return bearer.startsWith("tok:") ? { userId: bearer.slice(4) } : null;
  },
};
const launcher: RuntimeLauncher = {
  async ensureAwake(): Promise<RuntimeEndpoint> {
    return { baseUrl: "http://unused.local", token: "t" };
  },
  async sleep() {},
  async destroy() {},
  async status() {
    return "running";
  },
};
const store = new MemoryWorkspaceStore();
const credentials = new MemoryCredentialStore();
const vfs = new MemoryVfs();

const deps = (gatewayFronted: boolean): ControlPlaneDeps => ({
  verifier,
  store,
  credentials,
  vault: { sandboxToken: () => "x", validateSandboxToken: () => null },
  channels: {
    gke: new ProxyChannel({
      launcher,
      proxy: { async forward() {} },
      credentials,
      forwardActingHeader: gatewayFronted,
    }),
  },
  vfs,
  capabilities: {
    profile: "cloud",
    revealInOs: false,
    terminal: false,
    tunnel: false,
    codeExecution: "remote-sandbox",
    providers: ["openai-codex"],
    openaiCompatible: false,
    integrations: [],
    sharedSkills: false,
  },
  triggersEnabled: true,
  ...(gatewayFronted ? { gatewayFronted: true } : {}),
});

const servers: Server[] = [];
let local = "";
let fronted = "";
let agentId = "";

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

beforeAll(async () => {
  local = await listen(createControlPlaneServer(deps(false)));
  fronted = await listen(createControlPlaneServer(deps(true)));
  const created = await fetch(`${local}/agents`, {
    method: "POST",
    headers: { Authorization: "Bearer tok:alice" },
    body: JSON.stringify({ name: "Helper" }),
  });
  agentId = ((await created.json()) as { id: string }).id;
});

afterAll(async () => {
  for (const server of servers)
    await new Promise<void>((r) => server.close(() => r()));
});

const headers = (floor?: string) => ({
  Authorization: "Bearer tok:alice",
  "Content-Type": "application/json",
  ...(floor ? { [ROUTINE_FLOOR_HEADER]: floor } : {}),
});

const create = (base: string, schedule: string, floor?: string) =>
  fetch(`${base}/agents/${agentId}/routines`, {
    method: "POST",
    headers: headers(floor),
    body: JSON.stringify({ name: "Inbox", prompt: "Check it", schedule }),
  });

const patch = (base: string, id: string, body: object, floor?: string) =>
  fetch(`${base}/agents/${agentId}/routines/${id}`, {
    method: "PATCH",
    headers: headers(floor),
    body: JSON.stringify(body),
  });

/** The refusal body, which must be exactly what the client's parser reads. */
const refusalOf = async (res: Response): Promise<unknown> => {
  const body = await res.json();
  expect(parsePlanMinIntervalRefusal(body)).toEqual(body);
  return body;
};

test("behind the gateway, a create under the stamped floor is refused", async () => {
  const res = await create(fronted, "*/5 * * * *", "15");
  expect(res.status).toBe(400);
  expect(await refusalOf(res)).toMatchObject({
    code: "plan_min_interval",
    minIntervalMinutes: 15,
    error: expect.stringContaining("at most once every 15 minutes"),
  });
});

test("a step that restarts under the floor at the top of the hour is refused", async () => {
  // */16 fires :48 then :00, 12 minutes apart.
  const res = await create(fronted, "*/16 * * * *", "15");
  expect(res.status).toBe(400);
  expect(await refusalOf(res)).toMatchObject({ code: "plan_min_interval" });
  expect((await create(fronted, "*/20 * * * *", "15")).status).toBe(201);
});

test("behind the gateway, an update is held to the floor; at the floor it saves", async () => {
  const created = await create(fronted, "*/15 * * * *", "15");
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as Routine;
  const tightened = await patch(fronted, id, { schedule: "*/5 * * * *" }, "15");
  expect(tightened.status).toBe(400);
  expect(await refusalOf(tightened)).toMatchObject({
    code: "plan_min_interval",
  });
  const paused = await patch(fronted, id, { enabled: false }, "15");
  expect(paused.status).toBe(200);
});

test("no stamp means no floor (Plus, or the plan system off)", async () => {
  expect((await create(fronted, "*/5 * * * *")).status).toBe(201);
});

test("off the gateway the header is client input and is ignored", async () => {
  expect((await create(local, "*/5 * * * *", "15")).status).toBe(201);
});

test("a garbled stamp is no floor, never a failed write", async () => {
  expect((await create(fronted, "*/5 * * * *", "soon")).status).toBe(201);
});

const ROUTINES_DOC = ".houston/routines/routines.json";

const putDoc = (base: string, items: unknown[], floor?: string) =>
  fetch(`${base}/agents/${agentId}/agentfile/${ROUTINES_DOC}`, {
    method: "PUT",
    headers: headers(floor),
    body: JSON.stringify({ content: JSON.stringify(items) }),
  });

const readDoc = async (base: string): Promise<Routine[]> => {
  const res = await fetch(
    `${base}/agents/${agentId}/agentfile/${ROUTINES_DOC}`,
    {
      headers: headers(),
    },
  );
  return JSON.parse(((await res.json()) as { content: string }).content);
};

const docRoutine = (id: string, schedule: string, enabled = true) => ({
  id,
  name: `Routine ${id}`,
  prompt: "Do it",
  schedule,
  enabled,
});

test("a raw routines-document write behind the gateway judges each changed routine", async () => {
  // A stored fast routine the person never touches in this write.
  const old = docRoutine("old-fast", "*/5 * * * *");
  expect((await putDoc(fronted, [old])).status).toBe(200);
  const stored = await readDoc(fronted);

  const added = await putDoc(
    fronted,
    [...stored, docRoutine("new-fast", "*/10 * * * *")],
    "15",
  );
  expect(added.status).toBe(400);
  expect(await refusalOf(added)).toMatchObject({ code: "plan_min_interval" });
  expect(await readDoc(fronted)).toEqual(stored);

  // Untouched, disabled and at-floor entries all pass.
  const ok = await putDoc(
    fronted,
    [
      ...stored,
      docRoutine("paused-fast", "*/5 * * * *", false),
      docRoutine("at-floor", "*/15 * * * *"),
    ],
    "15",
  );
  expect(ok.status).toBe(200);

  // Rewording the old fast routine is refused: its schedule must move first.
  const reworded = await putDoc(
    fronted,
    [{ ...old, prompt: "Do it better" }],
    "15",
  );
  expect(reworded.status).toBe(400);
  expect(await refusalOf(reworded)).toMatchObject({
    error: expect.stringContaining("already runs more often"),
  });
});

test("off the gateway a raw routines write ignores the header", async () => {
  const res = await putDoc(local, [docRoutine("x", "*/5 * * * *")], "15");
  expect(res.status).toBe(200);
});

const rawDoc = (
  base: string,
  content: string,
  method = "PUT",
  floor?: string,
) =>
  fetch(`${base}/agents/${agentId}/agentfile/${ROUTINES_DOC}`, {
    method,
    headers: headers(floor),
    body: JSON.stringify({ content }),
  });

test("a BOM'd routines doc is read like every reader reads it: a fast entry is refused", async () => {
  expect((await putDoc(fronted, [])).status).toBe(200);
  const bommed = `\uFEFF${JSON.stringify([docRoutine("bom-fast", "*/5 * * * *")])}`;
  const res = await rawDoc(fronted, bommed, "PUT", "15");
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ code: "plan_min_interval" });
});

test("a corrupt stored routines doc never blocks the write that repairs it", async () => {
  // No floor on this write: the corrupt bytes land as they would on any pod.
  expect((await rawDoc(fronted, "{ not json at all")).status).toBe(200);
  const res = await putDoc(fronted, [docRoutine("good", "0 9 * * *")], "15");
  expect(res.status).toBe(200);
  expect((await readDoc(fronted)).map((r) => r.id)).toEqual(["good"]);
});

test("the POST write of the routines doc is held to the floor too", async () => {
  const fast = JSON.stringify([docRoutine("post-fast", "*/5 * * * *")]);
  const refused = await rawDoc(fronted, fast, "POST", "15");
  expect(refused.status).toBe(400);
  const slow = JSON.stringify([docRoutine("post-slow", "*/30 * * * *")]);
  expect((await rawDoc(fronted, slow, "POST", "15")).status).toBe(200);
});
