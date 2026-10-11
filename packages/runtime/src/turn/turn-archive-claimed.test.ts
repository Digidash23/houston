import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDirStore } from "@houston/runtime-client/object-sync";
import { expect, test } from "vitest";
import { segments } from "../store/conversation-archive";
import { getHistoryAt } from "../store/conversation-file";
import { startTurnRequestFilesystem } from "./turn-claimed-hydration";

const PREFIX = "ws/acme/bob";
const AGENT = "workspaces/Personal/Bob";
const ARCHIVE = `${AGENT}/.houston/runtime/conversations/routine-r1.archive`;

function seed(): string {
  const storeRoot = mkdtempSync(join(tmpdir(), "archive-claimed-"));
  const put = (rel: string, body: unknown) => {
    const file = join(storeRoot, PREFIX, ...rel.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  };
  put(`${AGENT}/CLAUDE.md`, "# Bob\n");
  for (let n = 1; n <= 5; n++)
    put(`${ARCHIVE}/${n}.json`, {
      id: "routine-r1",
      segment: n,
      messages: [{ role: "assistant", content: `report ${n}`, ts: n }],
    });
  put(`${AGENT}/.houston/runtime/conversations/routine-r1.json`, {
    id: "routine-r1",
    title: "Daily report",
    createdAt: 1,
    updatedAt: 2,
    messages: [{ role: "user", content: "run", ts: 6 }],
    archived: { messages: 5, segments: [1, 1, 1, 1, 1] },
  });
  segments.clear();
  return storeRoot;
}

test("a claimed routine turn hydrates the newest segments and fetches older ones on demand", async () => {
  const storeRoot = seed();
  const preparation = await startTurnRequestFilesystem({
    store: new LocalDirStore(storeRoot),
    prefix: PREFIX,
    root: mkdtempSync(join(tmpdir(), "archive-claimed-root-")),
    turn: {
      conversationId: "routine-r1",
      claim: {
        id: "claim-1",
        token: "token-1",
        bootId: "boot-1",
        heartbeatUrl: "https://heartbeat.test",
      },
    },
    timings: {},
  });
  const filesystem = await preparation.hydrated;
  const onDisk = (n: number) =>
    existsSync(join(filesystem.storeRoot, ...ARCHIVE.split("/"), `${n}.json`));
  expect([1, 2, 3, 4, 5].map(onDisk)).toEqual([
    false,
    false,
    false,
    true,
    true,
  ]);
  const conversations = join(filesystem.dataDir, "conversations");
  await filesystem.loadArchive?.("routine-r1", {});
  expect([1, 2, 3].map(onDisk)).toEqual([true, true, true]);
  expect(
    getHistoryAt(conversations, "routine-r1")?.messages.map((m) => m.content),
  ).toEqual([
    "report 1",
    "report 2",
    "report 3",
    "report 4",
    "report 5",
    "run",
  ]);
});
