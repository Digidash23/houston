import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalDirStore } from "@houston/runtime-client/object-sync";
import { expect, test } from "vitest";
import type { TurnServerDeps } from "./server-types";
import { publishTurnActivityDoc } from "./turn-activity-doc";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnRequest } from "./types";

const workspaceRel = "workspaces/W/A";
const rel = `${workspaceRel}/.houston/activity/activity.json`;
const card = (id: string, status = "running") => ({
  id,
  title: id,
  status,
  description: "",
});

async function write(path: string, body: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body));
}

async function setup(stored: unknown[] | undefined) {
  const storeRoot = await mkdtemp(join(tmpdir(), "activity-store-"));
  if (stored) await write(join(storeRoot, "p", ...rel.split("/")), stored);
  const workspaceDir = await mkdtemp(join(tmpdir(), "activity-turn-"));
  // The turn's merged, uploaded board.
  await write(join(workspaceDir, ".houston", "activity", "activity.json"), [
    card("a", "needs_you"),
  ]);
  const puts: { ifMatch: string | null; doc: unknown }[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return Response.json({ revision: 3 });
    }
    const headers = new Headers(init.headers);
    puts.push({
      ifMatch: headers.get("If-Match"),
      doc: (JSON.parse(String(init.body)) as { doc: unknown }).doc,
    });
    // The gateway projected its own board write first.
    return puts.length === 1
      ? Response.json({ revision: 4 }, { status: 409 })
      : Response.json({ revision: 5 });
  }) as typeof fetch;
  const publish = () =>
    publishTurnActivityDoc(
      {
        poolStoreUrl: "https://store.example",
        fetchImpl,
        activityDocRetryDelaysMs: [],
      } as unknown as TurnServerDeps,
      {
        shadow: false,
        claim: { token: "t", bootId: "b" },
        hostToken: "host-token",
        gcsPrefix: "ws/acme/helper",
        conversationId: "c1",
        turnId: "turn-1",
      } as unknown as TurnRequest & { turnId: string },
      { workspaceDir, workspaceRel } as unknown as TurnFilesystem,
      { store: new LocalDirStore(storeRoot), prefix: "p" },
    );
  return { puts, publish };
}

test("a lost revision race re-derives the doc from the stored board, never the stale copy", async () => {
  const { puts, publish } = await setup([card("a", "needs_you"), card("g")]);
  expect(await publish()).toEqual({ ok: true });
  expect(puts).toEqual([
    { ifMatch: "3", doc: [card("a", "needs_you")] },
    { ifMatch: "4", doc: [card("a", "needs_you"), card("g")] },
  ]);
});

test("a lost race with an unreadable stored board skips instead of overwriting", async () => {
  const { puts, publish } = await setup(undefined);
  expect(await publish()).toEqual({ skipped: "stale_after_conflict" });
  expect(puts).toHaveLength(1);
});
