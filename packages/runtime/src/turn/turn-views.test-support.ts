import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadLearnings,
  loadSkills,
  normalizeRoutines,
  parseJsonDoc,
} from "@houston/domain";
import { FsVfs } from "@houston/host/src/vfs";
import {
  LocalDirStore,
  type ObjectStore,
  StoreConflictError,
  syncBack,
} from "@houston/runtime-client/object-sync";
import { expect } from "vitest";
import { applyOp } from "./op-apply";
import { projectDurableOp } from "./op-durability";
import { opClaimId, opTreeOptions } from "./op-tree-options";
import { parseOpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";
import { finishTurnDurability } from "./turn-durability";
import { prepareTurnFilesystem, type TurnFilesystem } from "./turn-filesystem";
import { handleTurnWriteRoute } from "./turn-sandbox-writes";
import type { TurnRequest } from "./types";

/**
 * A sleeping agent's store, the pod-store docs route, claimed turns and ops
 * over it: what the view-doc tests interleave to prove a publish never rolls
 * back a concurrent writer.
 */

export const PREFIX = "ws/w1/agent-1";
export const WORKSPACE_REL = "workspaces/W/A";
export const ROUTINES_REL = `${WORKSPACE_REL}/.houston/routines/routines.json`;

export async function seed(root: string, rel: string, content: string) {
  const path = join(root, ...rel.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export const skillMd = (slug: string, description: string) =>
  `---\nname: ${slug}\ndescription: ${description}\n---\n\nDo the ${slug}.\n`;

/** A stored routine as the checked write path leaves it. */
export const routine = (id: string, prompt: string, at = "2026-09-01") => ({
  id,
  name: `Routine ${id}`,
  prompt,
  enabled: true,
  suppress_when_silent: false,
  chat_mode: "shared",
  provider: null,
  model: null,
  effort: null,
  integrations: [],
  schedule: "0 9 * * *",
  created_at: `${at}T00:00:00.000Z`,
  updated_at: `${at}T00:00:00.000Z`,
});

type DocsOptions = {
  refusing?: string[];
  outOfScope?: string[];
  /** Holds a GET (by family and claim conversation) until it resolves. */
  hold?: (family: string, conversation: string) => Promise<void> | undefined;
};

/** The pod-store docs route: per-family revisioned CAS (409 names the doc). */
export function podDocs(
  initial: Record<string, unknown> = {},
  opts: DocsOptions = {},
) {
  const docs = new Map<string, { doc: unknown; revision: number }>(
    Object.entries(initial).map(([family, doc]) => [
      family,
      { doc, revision: 1 },
    ]),
  );
  const requests: Array<{ family: string; method: string }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const family = String(url).split("/").at(-1) ?? "";
    const method = init?.method ?? "GET";
    requests.push({ family, method });
    if (method === "GET") {
      const conversation =
        new Headers(init?.headers).get("X-Houston-Claim-Conversation") ?? "";
      await opts.hold?.(family, conversation);
    }
    const current = docs.get(family);
    if (method === "GET") {
      return current
        ? Response.json(current)
        : Response.json({ error: "document not found" }, { status: 404 });
    }
    if (opts.refusing?.includes(family)) {
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
    if (opts.outOfScope?.includes(family)) {
      return Response.json(
        { error: "family outside claim scope" },
        { status: 403 },
      );
    }
    const expected = Number(new Headers(init?.headers).get("If-Match"));
    if (expected !== (current?.revision ?? 0)) {
      return Response.json(current, { status: 409 });
    }
    const next = {
      doc: (JSON.parse(String(init?.body)) as { doc: unknown }).doc,
      revision: expected + 1,
    };
    docs.set(family, next);
    return Response.json(next);
  }) as typeof fetch;
  return {
    fetchImpl,
    requests,
    doc: (family: string) => docs.get(family)?.doc,
  };
}

export type PodDocs = ReturnType<typeof podDocs>;

/**
 * Holds one writer's first GET of `family` (by its claim conversation) until
 * the test releases it: the window between a writer landing its file and
 * reading the doc revision it publishes at.
 */
export function holdFirstGet(family: string, conversation: string) {
  let reached!: () => void;
  const atGet = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const hold = (f: string, c: string) => {
    if (f !== family || c !== conversation || held) return;
    held = true;
    reached();
    return released;
  };
  return { hold, atGet, release };
}

export interface StoreHooks {
  /** Runs before an upload of `key` lands: another writer can land first. */
  beforeUpload?: (key: string) => Promise<void> | undefined;
}

/**
 * Runs `race` once, before the first upload of a key ending in `suffix`:
 * the window between a writer's read of a document and its CAS write.
 */
export function raceFirstUpload(
  hooks: StoreHooks,
  suffix: string,
  race: () => Promise<void>,
) {
  hooks.beforeUpload = (key) => {
    if (!key.endsWith(suffix)) return undefined;
    hooks.beforeUpload = undefined;
    return race();
  };
}

/**
 * LocalDirStore with the pool store's generations: every write bumps the
 * key's generation and a write whose `ifGenerationMatch` names another one is
 * a 412. Operations run one at a time, so the fake itself never loses a write.
 */
export function generationalStore(
  root: string,
  hooks: StoreHooks = {},
): ObjectStore {
  const inner = new LocalDirStore(root);
  const generations = new Map<string, number>();
  const current = (key: string) =>
    existsSync(join(root, ...key.split("/"))) ? (generations.get(key) ?? 1) : 0;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };
  const check = (key: string, expected: string | undefined) => {
    const generation = current(key);
    if (expected !== undefined && expected !== String(generation))
      throw new StoreConflictError(key, `412 at ${generation}`);
    return generation;
  };
  return {
    list: (prefix) => serial(() => inner.list(prefix)),
    manifest: (prefix) =>
      serial(async () =>
        (await inner.manifest(prefix)).map((object) => ({
          ...object,
          generation: String(current(object.key)),
        })),
      ),
    download: (key, dest) => serial(() => inner.download(key, dest)),
    downloadVersioned: (key, dest) =>
      serial(async () => {
        await inner.download(key, dest);
        return { generation: String(current(key)) };
      }),
    upload: async (source, key, opts) => {
      // Outside the queue: the racing writer's own operations must run.
      const race = hooks.beforeUpload?.(key);
      if (race) await race;
      return serial(async () => {
        const generation = check(key, opts?.ifGenerationMatch) + 1;
        await inner.upload(source, key);
        generations.set(key, generation);
        return { generation: String(generation) };
      });
    },
    delete: (key, opts) =>
      serial(async () => {
        check(key, opts?.ifGenerationMatch);
        await inner.delete(key);
        generations.delete(key);
      }),
  };
}

/** A store holding a standing agent with one skill, one memory and, with
 *  `routines`, that routines file. */
export async function agentStore(routines?: unknown[]) {
  const storeRoot = await mkdtemp(join(tmpdir(), "turn-views-store-"));
  const prefixRoot = join(storeRoot, ...PREFIX.split("/"));
  await seed(
    prefixRoot,
    `${WORKSPACE_REL}/.houston/runtime/settings.json`,
    "{}",
  );
  await seed(prefixRoot, `${WORKSPACE_REL}/CLAUDE.md`, "# A\n");
  await seed(
    prefixRoot,
    `${WORKSPACE_REL}/.agents/skills/existing/SKILL.md`,
    skillMd("existing", "Already here"),
  );
  await seed(
    prefixRoot,
    `${WORKSPACE_REL}/.houston/learnings/learnings.json`,
    JSON.stringify([
      {
        id: "l0",
        text: "Signs off as Ana",
        created_at: "2026-09-01T00:00:00Z",
      },
    ]),
  );
  if (routines) await seed(prefixRoot, ROUTINES_REL, JSON.stringify(routines));
  const hooks: StoreHooks = {};
  return {
    storeRoot,
    prefixRoot,
    hooks,
    store: generationalStore(storeRoot, hooks),
  };
}

export type AgentStore = Awaited<ReturnType<typeof agentStore>>;

/** One family's doc target on `docs`, under a turn claim. */
export const docTargetFor = (docs: PodDocs, family: string) => ({
  family,
  baseUrl: "https://store.example",
  org: "w1",
  agent: "agent-1",
  conversationId: "c1",
  hostToken: "host-token",
  claim: { token: "t", bootId: "b" },
  fetchImpl: docs.fetchImpl,
  retryDelaysMs: [],
});

const docDeps = (docs: PodDocs) =>
  ({
    poolStoreUrl: "https://store.example",
    fetchImpl: docs.fetchImpl,
    activityDocRetryDelaysMs: [],
  }) as unknown as TurnServerDeps;

/** One claimed turn hydrated from `agent`, publishing to `docs`. */
export async function claimedTurn(
  agent: AgentStore,
  docs: PodDocs,
  conversationId = "c1",
  opts: { routine?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "turn-views-root-"));
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root,
    claimed: true,
  });
  const turn = {
    shadow: false,
    claim: { id: "c", token: "t", bootId: "b", heartbeatUrl: "https://x" },
    hostToken: "host-token",
    gcsPrefix: PREFIX,
    conversationId,
    turnId: `turn-${conversationId}`,
    ...(opts.routine ? { routine: { id: "r1" } } : {}),
  } as unknown as TurnRequest & { turnId: string };
  const settle = () =>
    finishTurnDurability({
      deps: docDeps(docs),
      turn,
      filesystem,
      resolved: { store: agent.store, prefix: PREFIX },
      heartbeat: null,
      outcome: {},
      transcript: null,
    });
  const writeRoute = async (path: string, body: Record<string, unknown>) =>
    handleTurnWriteRoute(path, body, {
      store: agent.store,
      prefix: PREFIX,
      filesystem,
      workspaceId: "W",
      conversationId,
    });
  /** The agent's save_learning tool: a CAS write straight to the store. */
  const saveLearning = async (text: string) => {
    const response = await writeRoute("/sandbox/learnings/save", { text });
    expect(response?.status).toBe(201);
  };
  /** The agent's save_routine tool (create without an id, else update). */
  const saveRoutine = async (body: Record<string, unknown>) => {
    const response = await writeRoute("/sandbox/routines/save", body);
    expect(response?.status).toBeLessThan(300);
  };
  return { filesystem, settle, saveLearning, saveRoutine };
}

/** The host's own GET skills answer over what the store now holds. */
export async function podSkillsAnswer(agent: AgentStore) {
  return loadSkills(
    new FsVfs(join(agent.prefixRoot, "workspaces")),
    WORKSPACE_REL.replace(/^workspaces\//, ""),
  );
}

export const writeSkill = (
  fs: TurnFilesystem,
  slug: string,
  description: string,
) =>
  seed(
    fs.workspaceDir,
    `.agents/skills/${slug}/SKILL.md`,
    skillMd(slug, description),
  );

export const skillNames = (docs: PodDocs) =>
  (docs.doc("skills") as { items: { name: string }[] }).items.map(
    (item) => item.name,
  );

/** The pod's own learnings read over what the store now holds. */
export async function podLearnings(agent: AgentStore) {
  return (await loadLearnings(new FsVfs(agent.prefixRoot), WORKSPACE_REL))
    .items;
}

/** The routines the store holds now, normalized as the projector reads them. */
export async function storedRoutines(agent: AgentStore) {
  const raw = await readFile(
    join(agent.prefixRoot, ...ROUTINES_REL.split("/")),
    "utf8",
  );
  return normalizeRoutines(parseJsonDoc(raw, ROUTINES_REL), ROUTINES_REL).items;
}

let claimOrigin: Promise<string> | undefined;

/** The op claim's origin, which also serves the custom-integration secrets
 *  store: every request answers `200 {}` (no secret held). */
function localClaimOrigin(): Promise<string> {
  claimOrigin ??= new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("{}");
    });
    server.unref();
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });
  return claimOrigin;
}

/**
 * A sleeping agent's op, run the way executeOp runs it (the real
 * handler over a lazy tree, the scoped sync-back), split before its doc
 * projection so a test can interleave a turn's publish. `beforeApply` runs
 * between the op's listing and its handler, `beforeSync` between the
 * handler's write and the sync-back: another writer landing in either makes
 * the op's upload lose its generation race.
 */
export async function landOp(
  agent: AgentStore,
  docs: PodDocs,
  route: { method: string; rest: string; body?: unknown },
  race: {
    beforeApply?: () => Promise<void>;
    beforeSync?: () => Promise<void>;
  } = {},
) {
  const op = parseOpRequest({
    workspaceId: "w1",
    agentId: "agent-1",
    gcsPrefix: PREFIX,
    hostToken: "host-token",
    claim: {
      id: "ops",
      bootId: "b",
      token: "t",
      heartbeatUrl: `${await localClaimOrigin()}/heartbeat`,
    },
    triggersEnabled: false,
    op: {
      kind: "route",
      method: route.method,
      rest: route.rest,
      contentType: "application/json",
      body: route.body === undefined ? "" : JSON.stringify(route.body),
    },
  });
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root: await mkdtemp(join(tmpdir(), "turn-views-op-")),
    claimed: true,
    ...opTreeOptions(op.op),
  });
  await race.beforeApply?.();
  const result = await applyOp(op, filesystem);
  expect(result.status, result.body).toBeLessThan(300);
  await race.beforeSync?.();
  const synced = await syncBack(
    agent.store,
    PREFIX,
    filesystem.storeRoot,
    filesystem.manifest,
    {
      include: result.include,
      holdDeletesOnFailure: true,
      generations: filesystem.generationAware,
      workerMerge: true,
    },
  );
  expect(synced.conflicts).toEqual([]);
  return () =>
    projectDurableOp({
      deps: docDeps(docs),
      turn: { ...op, conversationId: opClaimId(op.op) },
      op,
      filesystem,
      result,
      uploaded: synced.uploaded,
      deleted: synced.deleted,
      source: { store: agent.store, prefix: PREFIX },
      prefix: PREFIX,
    });
}
