import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const guard = path.resolve(import.meta.dirname, "ota-commit-guard.sh");
let repo = "";
const shas: Record<string, string> = {};
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commit = (name: string) => {
  git("commit", "--allow-empty", "-q", "-m", name);
  shas[name] = git("rev-parse", "HEAD");
};
// The daily cut: a release commit on the main tip, reachable only by its tag.
const cut = (version: string, base: string) => {
  git("checkout", "-q", "--detach", shas[base] ?? "");
  commit(`release ${version}`);
  git("tag", "-a", `cloud-v${version}`, "-m", version);
  git("checkout", "-q", "main");
};

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ota-guard-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "test");
  commit("m1");
  commit("m2");
  cut("1.0.6", "m2");
  commit("m3");
  cut("1.0.7", "m3");
  git("checkout", "-q", "-b", "feature", shas.m3 ?? "");
  commit("f1");
  git("checkout", "-q", "main");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const run = (candidate: string, live = "") =>
  spawnSync(guard, ["main", candidate, live], { cwd: repo, encoding: "utf8" });

test("a tagged release cut from main publishes over the previous release", () => {
  const live = shas["release 1.0.6"]?.slice(0, 7) ?? "";
  expect(run("cloud-v1.0.7", live).status).toBe(0);
  expect(run("cloud-v1.0.6").status).toBe(0);
});

test("a main push publishes over a live release bundle cut from older main", () => {
  expect(run(shas.m3 ?? "", shas["release 1.0.6"]?.slice(0, 7)).status).toBe(0);
});

test("an older release cannot replace a newer live bundle", () => {
  const result = run("cloud-v1.0.6", shas["release 1.0.7"]?.slice(0, 7));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("older than the live bundle");
  expect(run("cloud-v1.0.6", shas.m3).status).not.toBe(0);
});

test("an untagged commit off main never publishes, even one commit away", () => {
  const result = run(shas.f1 ?? "");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("neither on main nor a cloud-v release");
});
