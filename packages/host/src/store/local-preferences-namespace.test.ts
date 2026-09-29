import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPreference } from "@houston/domain";
import { expect, test } from "vitest";
import { agentRoots } from "../migrate/chat-history";
import { sweepGatewayGroupNotes } from "../migrate/gateway-group-notes";
import { LocalPaths } from "../paths";
import { FsVfs } from "../vfs";
import { LocalWorkspaceStore } from "./local";

/**
 * A standing engine pod runs the local profile: FsVfs and LocalWorkspaceStore
 * share one root, `/data/workspaces`. The preferences doc key
 * `ws/<wsId>/preferences.json` is therefore a real folder beside the
 * workspaces, and the pod once listed it as workspace `ws` with agent
 * `Personal`, then eagerly booted a runtime into `/data/workspaces/ws/Personal`
 * (staging agent "prime": runtime.log, models-store.json, the shell fence).
 */
function podTree() {
  const root = mkdtempSync(join(tmpdir(), "houston-pod-"));
  mkdirSync(join(root, "Personal", "prime"), { recursive: true });
  const store = new LocalWorkspaceStore(root);
  const vfs = new FsVfs(root);
  const errors: unknown[] = [];
  const sweep = () =>
    sweepGatewayGroupNotes({
      enginePod: true,
      store,
      vfs,
      paths: new LocalPaths(),
      log: (_message, error) => errors.push(error),
    });
  return { root, store, vfs, errors, sweep };
}

test("the boot sweep's preferences doc never becomes an agent", async () => {
  const { root, store, errors, sweep } = podTree();

  await sweep();

  // The doc lands where the preferences layout puts it...
  expect(existsSync(join(root, "ws", "Personal", "preferences.json"))).toBe(
    true,
  );
  // ...and the store still sees exactly one agent, the one the pod hosts.
  expect((await store.listWorkspaces()).map((ws) => ws.id)).toEqual([
    "Personal",
  ]);
  expect((await store.listAllAgents()).map((a) => a.id)).toEqual([
    "Personal/prime",
  ]);
  expect(await store.listAgents("ws")).toEqual([]);
  expect(await store.getWorkspace("ws")).toBeNull();
  expect(await store.getAgent("ws/Personal")).toBeNull();
  expect(agentRoots(root)).toEqual([join(root, "Personal", "prime")]);
  expect(errors).toEqual([]);
});

test("a second boot does not recurse into the preferences namespace", async () => {
  const { root, sweep } = podTree();

  await sweep();
  await sweep();

  expect(existsSync(join(root, "ws", "ws"))).toBe(false);
});

test("the personal workspace is never the preferences namespace", async () => {
  const root = mkdtempSync(join(tmpdir(), "houston-desktop-"));
  const vfs = new FsVfs(root);
  // A fresh desktop whose first write is a preference: `ws` is the only
  // folder on disk and must still not be picked as the personal workspace.
  await setPreference(vfs, "Personal", "locale", "es");
  const store = new LocalWorkspaceStore(root);

  expect((await store.getOrCreatePersonalWorkspace("local-owner")).id).toBe(
    "Personal",
  );
});
