import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Activity } from "@houston/protocol";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { beforeEach, expect, test, vi } from "vitest";
import { writeAuthFile } from "../auth/auth-file";
import type { ClaudeQuery } from "../backends/claude/session";
import type { HarnessBackend, HarnessSession } from "../backends/types";
import { changedEventTypes } from "./turn-changed-events";
import { turnActivityKey } from "./turn-filesystem";
import { turnTitleRunner, writeMissionTitleInTree } from "./turn-mission-title";
import { remoteActivityReader } from "./turn-mission-title-remote";
import { runTurn, type TurnDirectories } from "./turn-session";

vi.mock("./turn-runtime", () => ({
  createTurnModelRuntime: async () => ({
    modelRuntime: {},
    model: { provider: "openai-codex", id: "gpt-5.5", contextWindow: 200_000 },
  }),
}));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const FALLBACK = "Write the weekly...";
const TEXT = "Write the weekly sales report for the team";

async function directories(cards: Activity[]): Promise<TurnDirectories> {
  const turnRoot = await mkdtemp(join(tmpdir(), "mission-title-"));
  const workspaceDir = join(turnRoot, "workspace");
  const dataDir = join(workspaceDir, ".houston", "runtime");
  await mkdir(join(workspaceDir, ".houston", "activity"), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(activityPath(workspaceDir), JSON.stringify(cards));
  writeAuthFile(join(dataDir, "auth.json"), {
    anthropic: {
      type: "oauth",
      access: "sk-ant-oat01-turn",
      refresh: "",
      expires: Date.now() + 60_000,
    },
  });
  return { turnRoot, workspaceDir, dataDir };
}

const activityPath = (workspaceDir: string) =>
  join(workspaceDir, ".houston", "activity", "activity.json");

async function cardTitle(dirs: TurnDirectories, id: string) {
  const cards = JSON.parse(
    await readFile(activityPath(dirs.workspaceDir), "utf8"),
  ) as Activity[];
  return cards.find((c) => c.id === id)?.title;
}

const card = (id: string, title: string): Activity => ({
  id,
  title,
  description: "",
  status: "running",
});

/** A pi backend whose reply streams `reply`, or fails with a provider error. */
function backend(order: string[], fail = false): HarnessBackend {
  return {
    id: "pi",
    async createSession() {
      let listener: ((e: never) => void) | undefined;
      return {
        subscribe: (fn: (e: never) => void) => {
          listener = fn;
          return () => undefined;
        },
        prompt: async () => {
          order.push("reply");
          listener?.(
            (fail
              ? {
                  type: "provider_error",
                  data: { kind: "rate_limited", provider: "openai-codex" },
                }
              : { type: "text", data: "Here is the report." }) as never,
          );
        },
        abort: async () => undefined,
        dispose: () => undefined,
        setModel: async () => undefined,
        compact: async () => undefined,
        setThinkingLevel: () => undefined,
        getContextUsage: () => undefined,
      } as unknown as HarnessSession;
    },
  };
}

function turn(dirs: TurnDirectories, order: string[], fail = false) {
  const titleRunner = vi.fn(async (excerpt: string) => {
    order.push(`title:${excerpt}`);
    return "Weekly sales report";
  });
  const run = runTurn(
    dirs,
    {
      conversationId: "activity-m1",
      text: `<skill prompt> ${TEXT}`,
      provider: "openai-codex",
      emit: () => undefined,
      signal: undefined,
      turnId: "t1",
      missionTitle: { fallback: FALLBACK, text: TEXT },
    },
    { createBackend: () => backend(order, fail), titleRunner },
  );
  return { run, titleRunner };
}

test("titles the card in the hydrated tree after the reply", async () => {
  const dirs = await directories([card("m1", FALLBACK)]);
  const order: string[] = [];
  const { run } = turn(dirs, order);
  expect(await run).toEqual({ pendingInteraction: undefined });
  expect(order).toEqual(["reply", `title:${TEXT}`]);
  expect(await cardTitle(dirs, "m1")).toBe("Weekly sales report");
});

test("a card the user renamed keeps its name", async () => {
  const dirs = await directories([card("m1", "My own name")]);
  const { run } = turn(dirs, []);
  await run;
  expect(await cardTitle(dirs, "m1")).toBe("My own name");
});

test("a failed turn never titles", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dirs = await directories([card("m1", FALLBACK)]);
  const { run, titleRunner } = turn(dirs, [], true);
  await run;
  expect(titleRunner).not.toHaveBeenCalled();
  expect(await cardTitle(dirs, "m1")).toBe(FALLBACK);
});

test("a title failure keeps the fallback and never fails the turn", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dirs = await directories([card("m1", FALLBACK)]);
  const outcome = await runTurn(
    dirs,
    {
      conversationId: "activity-m1",
      text: TEXT,
      provider: "openai-codex",
      emit: () => undefined,
      signal: undefined,
      turnId: "t1",
      missionTitle: { fallback: FALLBACK, text: TEXT },
    },
    {
      createBackend: () => backend([]),
      titleRunner: async () => {
        throw new Error("quota");
      },
    },
  );
  expect(outcome.error).toBeUndefined();
  expect(await cardTitle(dirs, "m1")).toBe(FALLBACK);
  expect(error).toHaveBeenCalled();
});

test("the written card announces ActivityChanged in the terminal frame", () => {
  const layout = {
    workspaceRel: "workspaces/Houston/Agent",
    dataRel: "workspaces/Houston/Agent/.houston/runtime",
  };
  expect(
    changedEventTypes(layout, [turnActivityKey(layout.workspaceRel)]),
  ).toEqual(["ActivityChanged"]);
});

test("writeMissionTitleInTree finds the card by its conversation", async () => {
  const dirs = await directories([card("m1", FALLBACK), card("m2", FALLBACK)]);
  expect(
    await writeMissionTitleInTree(
      dirs.workspaceDir,
      "activity-m2",
      "T",
      FALLBACK,
    ),
  ).toBe(true);
  expect(await cardTitle(dirs, "m1")).toBe(FALLBACK);
  expect(await cardTitle(dirs, "m2")).toBe("T");
});

test("anthropic titles through the Claude SDK on the turn's own token and model", async () => {
  const dirs = await directories([]);
  let seen: Options | undefined;
  const query: ClaudeQuery = async function* ({ options }) {
    seen = options;
    yield {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Weekly sales report" },
      },
      session_id: "s",
      parent_tool_use_id: null,
    } as unknown as SDKMessage;
  };
  const run = turnTitleRunner({
    provider: "anthropic",
    model: { id: "claude-sonnet-4-6" },
    modelRuntime: {} as ModelRuntime,
    directories: dirs,
    claudeQuery: query,
  });
  const abort = new AbortController();
  expect(await run(TEXT, abort.signal)).toBe("Weekly sales report");
  expect(seen?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-turn");
  expect(seen?.model).toContain("sonnet");
  abort.abort();
  expect(seen?.abortController?.signal.aborted).toBe(true);
});

test("a card hydration missed is titled from the fresh stored board", async () => {
  // Hydrated before the card landed: the local board has only an older card.
  const dirs = await directories([card("old", "Older mission")]);
  const stored = [
    card("old", "Older mission"),
    { ...card("m1", FALLBACK), updated_at: "2026-09-28T10:00:00Z" },
  ];
  const readRemote = vi.fn(async () => stored);
  expect(
    await writeMissionTitleInTree(
      dirs.workspaceDir,
      "activity-m1",
      "Weekly sales report",
      FALLBACK,
      readRemote,
    ),
  ).toBe(true);
  expect(readRemote).toHaveBeenCalledOnce();
  // Local = the fresh stored doc with only that card retitled.
  expect(await cardTitle(dirs, "m1")).toBe("Weekly sales report");
  expect(await cardTitle(dirs, "old")).toBe("Older mission");
});

test("a stored card the user renamed keeps its name", async () => {
  const dirs = await directories([]);
  const readRemote = async () => [card("m1", "My own name")];
  expect(
    await writeMissionTitleInTree(
      dirs.workspaceDir,
      "activity-m1",
      "T",
      FALLBACK,
      readRemote,
    ),
  ).toBe(false);
});

test("a card found nowhere warns with its conversation", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dirs = await directories([]);
  expect(
    await writeMissionTitleInTree(
      dirs.workspaceDir,
      "activity-m1",
      "T",
      FALLBACK,
      async () => null,
    ),
  ).toBe(false);
  expect(
    warn.mock.calls.some((c) => String(c[0]).includes("activity-m1")),
  ).toBe(true);
});

test("the remote reader reads the store key sync-back writes", async () => {
  const keys: string[] = [];
  const store = {
    list: async () => [],
    upload: async () => undefined,
    delete: async () => undefined,
    download: async (key: string, dest: string) => {
      keys.push(key);
      await writeFile(dest, JSON.stringify([card("m1", FALLBACK)]));
    },
  } as unknown as ObjectStore;
  const read = remoteActivityReader(store, "", "workspaces/Houston/Agent");
  expect((await read())?.map((a) => a.id)).toEqual(["m1"]);
  expect(keys).toEqual([
    "workspaces/Houston/Agent/.houston/activity/activity.json",
  ]);
  const missing = remoteActivityReader(
    {
      ...store,
      download: async (key: string) => {
        throw new ObjectNotFoundError(key, "gone");
      },
    } as unknown as ObjectStore,
    "",
    "workspaces/Houston/Agent",
  );
  expect(await missing()).toBeNull();
});
