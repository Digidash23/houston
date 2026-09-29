import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadSkillsFromDirOptions } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

/**
 * The skill loader lists skills in directory-read order, which differs between
 * filesystems and so between pool workers. This seam replays one real load in
 * a different order, the way another worker's disk would hand it back.
 */
const readOrder = vi.hoisted(() => ({ reversed: false }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    loadSkillsFromDir: (options: LoadSkillsFromDirOptions) => {
      const loaded = actual.loadSkillsFromDir(options);
      return readOrder.reversed
        ? { ...loaded, skills: [...loaded.skills].reverse() }
        : loaded;
    },
  };
});

afterEach(() => {
  readOrder.reversed = false;
});

function workspaceWithSkills(): string {
  const dir = mkdtempSync(join(tmpdir(), "houston-skill-order-"));
  mkdirSync(join(dir, ".houston"), { recursive: true });
  // Folder names sort opposite to skill names, so neither order is an accident.
  for (const [slug, name] of [
    ["a-folder", "zeta-report"],
    ["m-folder", "mid-intake"],
    ["z-folder", "alpha-brief"],
  ]) {
    const skillDir = join(dir, ".agents", "skills", slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: The ${name} procedure\n---\n\nDo it.\n`,
    );
  }
  return dir;
}

test("two directory read orders produce a byte-identical Claude system prompt", () => {
  const dir = workspaceWithSkills();
  const asRead = buildSystemPrompt(dir, "You are Houston.");
  readOrder.reversed = true;
  const reversed = buildSystemPrompt(dir, "You are Houston.");

  expect(reversed).toBe(asRead);
  const names = [...asRead.matchAll(/<name>([^<]+)<\/name>/g)].map(
    (match) => match[1],
  );
  expect(names).toEqual(["alpha-brief", "mid-intake", "zeta-report"]);
});
