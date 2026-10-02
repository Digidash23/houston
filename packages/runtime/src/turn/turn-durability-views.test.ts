import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadLearnings, loadSkills } from "@houston/domain";
import { FsVfs } from "@houston/host/src/vfs";
import { LocalDirStore, syncBack } from "@houston/runtime-client/object-sync";
import { expect, test } from "vitest";
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
 * A pooled turn changes what a sleeping agent's tabs read: the gateway serves
 * the Skills tab from the captured skills view doc and the memories list from
 * the learnings doc. These pin that the turn's settle republishes exactly the
 * docs its landed writes changed, merge-safely, before it announces them.
 */

const PREFIX = "ws/w1/agent-1";
const WORKSPACE_REL = "workspaces/W/A";

async function seed(root: string, rel: string, content: string) {
  const path = join(root, ...rel.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const skillMd = (slug: string, description: string) =>
  `---\nname: ${slug}\ndescription: ${description}\n---\n\nDo the ${slug}.\n`;

/** The pod-store docs route: per-family revisioned CAS (409 names the doc). */
function podDocs(
  initial: Record<string, unknown> = {},
  opts: {
    refusing?: string[];
    outOfScope?: string[];
    /** Holds a GET (by family and claim conversation) until it resolves. */
    hold?: (family: string, conversation: string) => Promise<void> | undefined;
  } = {},
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

/** A store holding a standing agent with one skill and one memory. */
async function agentStore() {
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
  return { storeRoot, prefixRoot, store: new LocalDirStore(storeRoot) };
}

type AgentStore = Awaited<ReturnType<typeof agentStore>>;

/** One claimed turn hydrated from `agent`, publishing to `docs`. */
async function claimedTurn(
  agent: AgentStore,
  docs: ReturnType<typeof podDocs>,
  conversationId = "c1",
) {
  const root = await mkdtemp(join(tmpdir(), "turn-views-root-"));
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root,
    claimed: true,
  });
  const deps = {
    poolStoreUrl: "https://store.example",
    fetchImpl: docs.fetchImpl,
    activityDocRetryDelaysMs: [],
  } as unknown as TurnServerDeps;
  const turn = {
    shadow: false,
    claim: { id: "c", token: "t", bootId: "b", heartbeatUrl: "https://x" },
    hostToken: "host-token",
    gcsPrefix: PREFIX,
    conversationId,
    turnId: `turn-${conversationId}`,
  } as unknown as TurnRequest & { turnId: string };
  const settle = () =>
    finishTurnDurability({
      deps,
      turn,
      filesystem,
      resolved: { store: agent.store, prefix: PREFIX },
      heartbeat: null,
      outcome: {},
      transcript: null,
    });
  /** The agent's save_learning tool: a CAS write straight to the store. */
  const saveLearning = async (text: string) => {
    const response = await handleTurnWriteRoute(
      "/sandbox/learnings/save",
      { text },
      {
        store: agent.store,
        prefix: PREFIX,
        filesystem,
        workspaceId: "W",
        conversationId,
      },
    );
    expect(response?.status).toBe(201);
  };
  return { filesystem, settle, saveLearning };
}

/** The host's own GET skills answer over what the store now holds. */
async function podSkillsAnswer(agent: AgentStore) {
  return loadSkills(
    new FsVfs(join(agent.prefixRoot, "workspaces")),
    WORKSPACE_REL.replace(/^workspaces\//, ""),
  );
}

const writeSkill = (fs: TurnFilesystem, slug: string, description: string) =>
  seed(
    fs.workspaceDir,
    `.agents/skills/${slug}/SKILL.md`,
    skillMd(slug, description),
  );

test("a turn that adds a skill republishes the skills view and announces it", async () => {
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const { filesystem, settle } = await claimedTurn(agent, docs);
  await writeSkill(filesystem, "drafting", "Draft replies");

  const result = await settle();

  expect(result.outcome).toEqual({});
  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
  expect(
    (docs.doc("skills") as { items: { name: string }[] }).items.map(
      (item) => item.name,
    ),
  ).toEqual(["drafting", "existing"]);
  expect(result.changed).toContain("SkillsChanged");
});

test("a turn that deletes a skill drops it from the view and announces it", async () => {
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const { filesystem, settle } = await claimedTurn(agent, docs);
  await rm(join(filesystem.workspaceDir, ".agents", "skills", "existing"), {
    recursive: true,
  });

  const result = await settle();

  expect(docs.doc("skills")).toEqual({ items: [], diagnostics: [] });
  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
  expect(result.changed).toContain("SkillsChanged");
});

test("a turn that changes no skill or memory republishes nothing", async () => {
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const { filesystem, settle } = await claimedTurn(agent, docs);
  // An ordinary file and a skill's helper script: neither feeds a view doc.
  await seed(filesystem.workspaceDir, "notes.md", "draft\n");
  await seed(filesystem.workspaceDir, ".agents/skills/existing/run.py", "1\n");

  const result = await settle();

  expect(docs.requests).toEqual([]);
  expect(result.changed).toEqual(["FilesChanged", "SkillsChanged"]);
});

const skillNames = (docs: ReturnType<typeof podDocs>) =>
  (docs.doc("skills") as { items: { name: string }[] }).items.map(
    (item) => item.name,
  );

test("overlapping turns keep each other's skills in the view", async () => {
  // Both hydrate before either lands: each tree lacks the other's skill, so a
  // whole-list copy from the later turn would drop the earlier one's.
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const first = await claimedTurn(agent, docs, "c1");
  const second = await claimedTurn(agent, docs, "c2");
  await writeSkill(first.filesystem, "alpha", "First turn's");
  await writeSkill(second.filesystem, "beta", "Second turn's");

  await first.settle();
  await second.settle();

  expect(skillNames(docs)).toEqual(["alpha", "beta", "existing"]);
  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
});

test("turns settling at once merge into the view, never clobber", async () => {
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const turns = await Promise.all(
    ["c1", "c2", "c3"].map((cid) => claimedTurn(agent, docs, cid)),
  );
  await Promise.all(
    turns.map((turn, i) => writeSkill(turn.filesystem, `s${i}`, `Turn ${i}`)),
  );
  // One overlapping turn also removes the shared skill.
  await rm(
    join(turns[2]?.filesystem.workspaceDir ?? "", ".agents/skills/existing"),
    { recursive: true },
  );

  const results = await Promise.all(turns.map((turn) => turn.settle()));

  expect(skillNames(docs)).toEqual(["s0", "s1", "s2"]);
  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
  for (const result of results)
    expect(result.changed).toContain("SkillsChanged");
});

test("with no skills doc yet, the whole captured list is published", async () => {
  const agent = await agentStore();
  const docs = podDocs();
  const { filesystem, settle } = await claimedTurn(agent, docs);
  await writeSkill(filesystem, "drafting", "Draft replies");

  await settle();

  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
});

test("a skills view that did not land is not announced and fails nothing", async () => {
  const agent = await agentStore();
  const standing = await podSkillsAnswer(agent);
  const docs = podDocs({ skills: standing }, { refusing: ["skills"] });
  const { filesystem, settle } = await claimedTurn(agent, docs);
  await writeSkill(filesystem, "drafting", "Draft replies");
  await seed(filesystem.workspaceDir, "notes.md", "draft\n");

  const result = await settle();

  // The SKILL.md is durable; only the view lags until the next projection.
  expect(result.outcome).toEqual({});
  expect(docs.doc("skills")).toEqual(standing);
  expect(result.changed).toEqual(["FilesChanged"]);
});

/** The pod's own learnings read over what the store now holds. */
async function podLearnings(agent: AgentStore) {
  return (await loadLearnings(new FsVfs(agent.prefixRoot), WORKSPACE_REL))
    .items;
}

test("a turn that saves a memory republishes the learnings doc and announces it", async () => {
  const agent = await agentStore();
  const docs = podDocs({ learnings: await podLearnings(agent) });
  const { settle, saveLearning } = await claimedTurn(agent, docs);
  await saveLearning("Prefers mornings");

  const result = await settle();

  expect(result.outcome).toEqual({});
  expect(docs.doc("learnings")).toEqual(await podLearnings(agent));
  expect(
    (docs.doc("learnings") as { text: string }[]).map((item) => item.text),
  ).toEqual(["Signs off as Ana", "Prefers mornings"]);
  expect(result.changed).toContain("LearningsChanged");
});

test("overlapping turns' memories all reach the doc, in the store's order", async () => {
  // The second save merges the first into the object (sync-back's merge by
  // id reorders it), so neither turn's own copy is what the store holds.
  const agent = await agentStore();
  const docs = podDocs({ learnings: await podLearnings(agent) });
  const first = await claimedTurn(agent, docs, "c1");
  const second = await claimedTurn(agent, docs, "c2");
  await first.saveLearning("Prefers mornings");
  await second.saveLearning("Writes in Spanish");

  await second.settle();
  await first.settle();

  expect(docs.doc("learnings")).toEqual(await podLearnings(agent));
  expect(
    (docs.doc("learnings") as { text: string }[]).map((item) => item.text),
  ).toEqual(
    expect.arrayContaining([
      "Signs off as Ana",
      "Prefers mornings",
      "Writes in Spanish",
    ]),
  );
});

test("turns saving memories at once leave the doc equal to the store", async () => {
  const agent = await agentStore();
  const docs = podDocs({ learnings: await podLearnings(agent) });
  const turns = await Promise.all(
    ["c1", "c2", "c3"].map((cid) => claimedTurn(agent, docs, cid)),
  );
  for (const [i, turn] of turns.entries()) await turn.saveLearning(`Fact ${i}`);

  await Promise.all(turns.map((turn) => turn.settle()));

  expect(docs.doc("learnings")).toEqual(await podLearnings(agent));
  expect(docs.doc("learnings")).toHaveLength(4);
});

test("a learnings doc that did not land is not announced", async () => {
  const agent = await agentStore();
  const standing = await podLearnings(agent);
  const docs = podDocs({ learnings: standing }, { refusing: ["learnings"] });
  const { settle, saveLearning } = await claimedTurn(agent, docs);
  await saveLearning("Prefers mornings");

  const result = await settle();

  expect(result.outcome.error).toMatch(/learnings doc publish failed/);
  expect(docs.doc("learnings")).toEqual(standing);
  expect(result.changed).not.toContain("LearningsChanged");
});

test("a store whose turn claims cannot take the learnings doc keeps today's answer", async () => {
  // Rollout order: this worker may meet a pod-store that predates learnings
  // in the turn-claim doc scope (403). That is a diagnostic, never a failure.
  const agent = await agentStore();
  const docs = podDocs(
    { learnings: await podLearnings(agent) },
    { outOfScope: ["learnings"] },
  );
  const { settle, saveLearning } = await claimedTurn(agent, docs);
  await saveLearning("Prefers mornings");

  const result = await settle();

  expect(result.outcome).toEqual({});
  expect(result.changed).toContain("LearningsChanged");
});

test("a turn that settles late never re-serves a skill summary another turn replaced", async () => {
  // The first turn lands its edit, then stalls before its doc GET. A second
  // turn hydrates after that landing, edits the same skill again, lands and
  // publishes. The late publisher must not put its older summary back.
  let reached!: () => void;
  const atGet = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const agent = await agentStore();
  const docs = podDocs(
    { skills: await podSkillsAnswer(agent) },
    {
      hold: (family, conversation) => {
        if (family !== "skills" || conversation !== "c1" || held) return;
        held = true;
        reached();
        return released;
      },
    },
  );
  const first = await claimedTurn(agent, docs, "c1");
  await writeSkill(first.filesystem, "existing", "First edit");
  const firstSettled = first.settle();
  await atGet;
  const second = await claimedTurn(agent, docs, "c2");
  await writeSkill(second.filesystem, "existing", "Second edit");
  await second.settle();
  release();
  await firstSettled;

  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
  expect(
    (docs.doc("skills") as { items: { description: string }[] }).items[0]
      ?.description,
  ).toBe("Second edit");
});

test("a turn that deletes the memories file republishes an empty doc", async () => {
  const agent = await agentStore();
  const docs = podDocs({ learnings: await podLearnings(agent) });
  const { filesystem, settle } = await claimedTurn(agent, docs);
  await rm(join(filesystem.workspaceDir, ".houston", "learnings"), {
    recursive: true,
  });

  const result = await settle();

  expect(docs.doc("learnings")).toEqual([]);
  expect(result.changed).toContain("LearningsChanged");
});

const landSkillCreateOp = (
  agent: AgentStore,
  docs: ReturnType<typeof podDocs>,
  name: string,
) =>
  landOp(agent, docs, {
    method: "POST",
    rest: "skills",
    body: { name, description: `${name} op`, content: "Go" },
  });

/**
 * A sleeping agent's op, run the way executeOp runs it (the real
 * handler over a lazy tree, the scoped sync-back), split before its doc
 * projection so a test can interleave a turn's publish.
 */
async function landOp(
  agent: AgentStore,
  docs: ReturnType<typeof podDocs>,
  route: { method: string; rest: string; body: unknown },
) {
  const op = parseOpRequest({
    workspaceId: "w1",
    agentId: "agent-1",
    gcsPrefix: PREFIX,
    hostToken: "host-token",
    claim: { id: "ops", bootId: "b", token: "t", heartbeatUrl: "https://x" },
    triggersEnabled: false,
    op: {
      kind: "route",
      method: route.method,
      rest: route.rest,
      contentType: "application/json",
      body: JSON.stringify(route.body),
    },
  });
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root: await mkdtemp(join(tmpdir(), "turn-views-op-")),
    claimed: true,
    ...opTreeOptions(op.op),
  });
  const result = await applyOp(op, filesystem);
  expect(result.status).toBeLessThan(300);
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
  const deps = {
    poolStoreUrl: "https://store.example",
    fetchImpl: docs.fetchImpl,
    activityDocRetryDelaysMs: [],
  } as unknown as TurnServerDeps;
  return () =>
    projectDurableOp({
      deps,
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

test("an op that projects after a turn keeps the turn's skill", async () => {
  // The op lands `alpha` from a tree listed before the turn's `beta`, then
  // the turn publishes. A whole-list op snapshot would drop `beta`.
  const agent = await agentStore();
  const docs = podDocs({ skills: await podSkillsAnswer(agent) });
  const turn = await claimedTurn(agent, docs);
  const project = await landSkillCreateOp(agent, docs, "alpha");
  await writeSkill(turn.filesystem, "beta", "The turn's");
  await turn.settle();

  const announced = await project();

  expect(skillNames(docs)).toEqual(["alpha", "beta", "existing"]);
  expect(docs.doc("skills")).toEqual(await podSkillsAnswer(agent));
  expect(announced).toContain("SkillsChanged");
});

test("an op that projects after a turn keeps the turn's memory", async () => {
  // The Memories tab's whole-list save lands from a tree listed before the
  // turn's save_learning; projecting that list would drop the turn's fact.
  const agent = await agentStore();
  const docs = podDocs({ learnings: await podLearnings(agent) });
  const project = await landOp(agent, docs, {
    method: "PUT",
    rest: "learnings",
    body: {
      items: [
        ...(await podLearnings(agent)),
        { id: "l-op", text: "Saved from the tab", created_at: "2026-10-01" },
      ],
    },
  });
  const turn = await claimedTurn(agent, docs);
  await turn.saveLearning("Prefers mornings");
  await turn.settle();

  const announced = await project();

  expect(docs.doc("learnings")).toEqual(await podLearnings(agent));
  expect(docs.doc("learnings")).toHaveLength(3);
  expect(announced).toContain("LearningsChanged");
});

test("an op whose skills view the store would not take announces nothing", async () => {
  const agent = await agentStore();
  const docs = podDocs(
    { skills: await podSkillsAnswer(agent) },
    { outOfScope: ["skills"] },
  );
  const project = await landSkillCreateOp(agent, docs, "alpha");

  expect(await project()).toEqual([]);
});
