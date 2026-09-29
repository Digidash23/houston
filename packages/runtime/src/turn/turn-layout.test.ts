import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import {
  resolveListedLayout,
  resolveTurnLayout,
  type TurnSetupError,
} from "./turn-layout";

const root = () => mkdtemp(join(tmpdir(), "turn-layout-"));

test("resolves the single standing agent and creates its runtime data dir", async () => {
  const storeRoot = await root();
  const agentDir = join(storeRoot, "workspaces", "W", "A");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(storeRoot, "workspaces", "W", ".shared"), {
    recursive: true,
  });

  await expect(resolveTurnLayout(storeRoot)).resolves.toEqual({
    kind: "standing",
    workspaceDir: agentDir,
    workspaceRel: "workspaces/W/A",
    dataDir: join(agentDir, ".houston", "runtime"),
    dataRel: "workspaces/W/A/.houston/runtime",
  });
  await expect(access(join(agentDir, ".houston", "runtime"))).resolves.toBe(
    undefined,
  );
});

test.each([
  "data",
  "workspace",
])("resolves a cloudrun tree containing %s", async (present) => {
  const storeRoot = await root();
  await mkdir(join(storeRoot, present));

  await expect(resolveTurnLayout(storeRoot)).resolves.toEqual({
    kind: "cloudrun",
    workspaceDir: join(storeRoot, "workspace"),
    workspaceRel: "workspace",
    dataDir: join(storeRoot, "data"),
    dataRel: "data",
  });
});

test("an empty tree is a brand-new cloudrun layout", async () => {
  const storeRoot = await root();
  await expect(resolveTurnLayout(storeRoot)).resolves.toMatchObject({
    kind: "cloudrun",
    dataRel: "data",
  });
});

test.each([
  ["multiple agents", ["workspaces/W/A", "workspaces/W/B"]],
  ["standing plus cloudrun", ["workspaces/W/A", "data"]],
])("rejects an ambiguous %s tree", async (_name, directories) => {
  const storeRoot = await root();
  await Promise.all(
    directories.map((directory) =>
      mkdir(join(storeRoot, ...directory.split("/")), { recursive: true }),
    ),
  );

  await expect(resolveTurnLayout(storeRoot)).rejects.toMatchObject({
    code: "layout_unexpected",
  } satisfies Partial<TurnSetupError>);
});

async function seedFiles(storeRoot: string, rels: string[]) {
  await Promise.all(
    rels.map(async (rel) => {
      const path = join(storeRoot, ...rel.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "x");
    }),
  );
}

// The staging store of agent "prime": the real agent beside the folder a
// standing pod wrote for its preferences doc and then booted a runtime into.
const PRIME = [
  "workspaces/Personal/prime/CLAUDE.md",
  "workspaces/Personal/prime/.houston/activity/activity.json",
  "workspaces/Personal/prime/.houston/config/config.json",
];
const STRAY = [
  "workspaces/ws/Personal/preferences.json",
  "workspaces/ws/Personal/.houston/runtime/models-store.json",
  "workspaces/ws/Personal/.houston/runtime/runtime.log",
  "workspaces/ws/Personal/.houston/runtime/bin/claude-shell-fence",
  // A later boot's schema re-seed writes into any folder with a `.houston/`.
  "workspaces/ws/Personal/.houston/activity/activity.schema.json",
];

test("a stray non-agent folder beside the agent is ignored", async () => {
  const storeRoot = await root();
  await seedFiles(storeRoot, [...PRIME, ...STRAY]);

  await expect(resolveTurnLayout(storeRoot)).resolves.toMatchObject({
    kind: "standing",
    workspaceRel: "workspaces/Personal/prime",
    dataRel: "workspaces/Personal/prime/.houston/runtime",
  });
});

test("the listing picks the agent while only the skeleton is on disk", async () => {
  const storeRoot = await root();

  await expect(
    resolveListedLayout(storeRoot, [...STRAY, ...PRIME], { allowEmpty: false }),
  ).resolves.toMatchObject({ workspaceRel: "workspaces/Personal/prime" });
});

test.each([
  ["instructions", "CLAUDE.md"],
  ["skills", ".agents/skills/report/SKILL.md"],
])("two real agents are still ambiguous (%s)", async (_name, marker) => {
  const storeRoot = await root();
  await seedFiles(storeRoot, [...PRIME, `workspaces/Personal/other/${marker}`]);

  await expect(resolveTurnLayout(storeRoot)).rejects.toMatchObject({
    code: "layout_unexpected",
  } satisfies Partial<TurnSetupError>);
});
