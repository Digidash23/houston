import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { LEGACY_SETUP_BEGIN, LEGACY_SETUP_END } from "@houston/domain";
import { afterEach, expect, test } from "vitest";
import { AGENT_STORE_MIGRATION_PATHS, migrateAgentStore } from "./agent-store";

/**
 * A pool worker hydrates only AGENT_STORE_MIGRATION_PATHS before it runs the
 * migrations. A step that reads or writes any other agent file would see a
 * different tree there than on a pod, so the migration over the admitted
 * files alone must land exactly what it lands over the whole agent.
 */

const AGENT = join("Personal", "Ledger");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

const FIXTURE: Record<string, string> = {
  "CLAUDE.md": `# Ledger\n\n${LEGACY_SETUP_BEGIN}\nSend ONE email.\n${LEGACY_SETUP_END}\n`,
  "GROUP.md": "# Group\n",
  ".houston/activity.json": '[{"id":"flat"}]',
  ".houston/activity/activity.json": '[{"id":"family"}]',
  ".houston/routines.json": '[{"id":"r1","schedule":"0 9 * * *"}]',
  ".houston/config.json": '{"model":"opus"}',
  ".houston/memory/learnings.md": "- Prefers short replies\n",
  ".houston/prompts/system.md": "old prompt",
  ".houston/routines/routines.schema.json": '{"stale":true}',
  ".houston/backups/2026-09-29/snapshot.tgz": "tarball",
  ".houston/sessions/claude/s1.json": "{}",
  ".houston/runtime/auth.json": "{}",
  "report.pdf": "pdf",
};

/** Every file under the agent, agent-relative and `/`-joined. */
function tree(agentRoot: string, dir = agentRoot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, tree(agentRoot, path));
    else
      out[relative(agentRoot, path).split(sep).join("/")] = readFileSync(
        path,
        "utf8",
      );
  }
  return out;
}

/** learnings.md converts with fresh ids and timestamps on every run. */
const comparable = (files: Record<string, string>) => {
  const key = ".houston/learnings/learnings.json";
  const learnings = files[key];
  if (learnings === undefined) return files;
  const entries = JSON.parse(learnings) as { text: string }[];
  return { ...files, [key]: entries.map((entry) => entry.text).join("\n") };
};

async function migrated(admit: (rel: string) => boolean) {
  const workspacesRoot = mkdtempSync(join(tmpdir(), "agent-store-paths-"));
  roots.push(workspacesRoot);
  const agentRoot = join(workspacesRoot, AGENT);
  for (const [rel, content] of Object.entries(FIXTURE)) {
    if (!admit(rel)) continue;
    const path = join(agentRoot, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  const report = await migrateAgentStore({
    workspacesRoot,
    agentRoot,
    ownerSub: "owner-1",
    log: () => {},
  });
  return { report, files: comparable(tree(agentRoot)) };
}

test("the migration over the admitted files lands what it lands over the whole agent", async () => {
  const whole = await migrated(() => true);
  const admitted = await migrated((rel) =>
    AGENT_STORE_MIGRATION_PATHS.has(rel),
  );

  expect(admitted.report).toEqual(whole.report);
  expect(whole.report.layoutFiles).toBeGreaterThan(0);
  const untouched = Object.keys(FIXTURE).filter(
    (rel) => !AGENT_STORE_MIGRATION_PATHS.has(rel),
  );
  const wholeAdmitted = Object.fromEntries(
    Object.entries(whole.files).filter(([rel]) => !untouched.includes(rel)),
  );
  expect(admitted.files).toEqual(wholeAdmitted);
  // Nothing outside the admitted paths was written, moved or removed.
  for (const rel of untouched) expect(whole.files[rel]).toBe(FIXTURE[rel]);
  for (const rel of Object.keys(whole.files))
    expect(
      AGENT_STORE_MIGRATION_PATHS.has(rel) || untouched.includes(rel),
    ).toBe(true);
});
