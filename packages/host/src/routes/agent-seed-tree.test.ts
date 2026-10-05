import { FAMILIES, schemaKey } from "@houston/domain";
import { expect, test } from "vitest";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import { seedAgentTree } from "./agent-seed-tree";

async function freshAgent() {
  const store = new MemoryWorkspaceStore();
  const vfs = new MemoryVfs();
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const agent = await store.createAgent({ workspaceId: ws.id, name: "Ledger" });
  return { store, vfs, ws, agent, root: `Personal/${agent.name}` };
}

test("a new agent's tree holds every family schema, its CLAUDE.md and its seeds", async () => {
  const { store, vfs, agent, root } = await freshAgent();
  await seedAgentTree({ store, vfs }, agent, root, {
    claudeMd: "# Ledger\n",
    seeds: { ".agents/skills/close/SKILL.md": "---\nname: Close\n---\n" },
  });
  for (const family of FAMILIES) {
    expect(await vfs.readText(schemaKey(root, family)), family).not.toBeNull();
  }
  expect(await vfs.readText(`${root}/CLAUDE.md`)).toBe("# Ledger\n");
  expect(await vfs.readText(`${root}/.agents/skills/close/SKILL.md`)).toContain(
    "name: Close",
  );
});

test("seeded routines are stamped with the creating user", async () => {
  const { store, vfs, agent, root } = await freshAgent();
  await seedAgentTree(
    { store, vfs },
    agent,
    root,
    {
      seeds: {
        ".houston/routines/routines.json": JSON.stringify([{ id: "r1" }]),
      },
    },
    "user-7",
  );
  const routines = JSON.parse(
    (await vfs.readText(`${root}/.houston/routines/routines.json`)) ?? "[]",
  );
  expect(routines).toEqual([{ id: "r1", created_by: "user-7" }]);
});

test("a seed that cannot be written rolls the agent back and rethrows", async () => {
  const { store, vfs, agent, root } = await freshAgent();
  await expect(
    seedAgentTree({ store, vfs }, agent, root, {
      seeds: { "notes.json": "[]", "../evil": "x" },
    }),
  ).rejects.toThrow(/unsafe seed path/);
  expect(await store.getAgent(agent.id)).toBeNull();
  expect(await vfs.list(root)).toEqual([]);
});
