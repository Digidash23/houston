import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRoutine } from "@houston/domain";
import { LocalDirStore } from "@houston/runtime-client/object-sync";
import { afterEach, expect, test, vi } from "vitest";
import {
  fakePoolStore,
  HEARTBEAT_URL,
  POOL_STORE_URL,
} from "./pool-store.test-support";
import { createTurnServer } from "./server";
import type { TurnRunner } from "./turn-session";

/**
 * A pooled turn is someone's next message: on a shared agent, only the person
 * the conversation's live card is for may send it. The refusal is a plain 403
 * before the stream opens, so nothing reaches the turnlog or the transcript.
 */

const AGENT = "workspaces/Personal/Probe";
const RUNTIME = `${AGENT}/.houston/runtime`;
const OWNER = "member-owner";
const OTHER = "member-other";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const cardConversation = (id: string) =>
  JSON.stringify({
    id,
    title: "Chat",
    createdAt: 1,
    updatedAt: 2,
    messages: [
      {
        role: "user",
        content: "send it",
        ts: 1,
        turnId: "t1",
        author: { userId: OWNER },
      },
      {
        role: "assistant",
        content: "",
        ts: 2,
        turnId: "t1",
        pendingInteraction: {
          steps: [{ kind: "question", id: "q1", question: "Send it?" }],
        },
      },
    ],
  });

async function pooledTurn(
  conversationId: string,
  extra: Record<string, unknown>,
  seed: (put: (rel: string, content: string) => void) => void = () => {},
) {
  const pool = fakePoolStore("ws/org/agent");
  pool.put(`${AGENT}/CLAUDE.md`, "# Probe\n");
  pool.put(`${AGENT}/.houston/activity/activity.json`, "[]");
  const conversationKey = `${RUNTIME}/conversations/${conversationId}.json`;
  pool.put(conversationKey, cardConversation(conversationId));
  seed(pool.put);
  const turnlog: string[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes("/v1/pod/turnlog/")) {
      turnlog.push(String(init?.body));
      return new Response(null, { status: 204 });
    }
    return pool.fetchImpl(input as string, init);
  }) as typeof fetch;
  const runTurn = vi.fn<TurnRunner>(async () => ({}));
  const server = createTurnServer({
    store: new LocalDirStore(pool.root),
    token: "",
    runTurn,
    poolStoreUrl: POOL_STORE_URL,
    turnLogUrl: "https://gateway.test",
    fetchImpl,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "org",
      agentId: "agent",
      conversationId,
      text: "yes",
      gcsPrefix: "ws/org/agent",
      credential: {
        provider: "openai-codex",
        access: "token",
        expires: Date.now() + 60_000,
      },
      hostToken: "host-token",
      claim: {
        id: "1",
        token: "1",
        bootId: "boot",
        heartbeatUrl: HEARTBEAT_URL,
      },
      ...extra,
    }),
  });
  return {
    res,
    text: await res.text(),
    runTurn,
    turnlog,
    pool,
    conversationKey,
  };
}

test("another member's message is refused with a 403 before the stream opens", async () => {
  const out = await pooledTurn("c1", { actingAs: { userId: OTHER } });

  expect(out.res.status).toBe(403);
  expect(out.res.headers.get("content-type")).toMatch(/application\/json/);
  expect(JSON.parse(out.text)).toEqual({
    error: "not_interaction_owner",
    code: "not_interaction_owner",
  });
  expect(out.runTurn).not.toHaveBeenCalled();
  expect(out.turnlog).toEqual([]);
  expect(out.pool.transcripts).toEqual([]);
  expect(out.pool.writes).toEqual([]);
  expect(JSON.parse(out.pool.read(out.conversationKey))).toEqual(
    JSON.parse(cardConversation("c1")),
  );
});

test("the person the card is for runs the turn", async () => {
  const out = await pooledTurn("c1", { actingAs: { userId: OWNER } });

  expect(out.res.status).toBe(200);
  expect(out.res.headers.get("content-type")).toMatch(/text\/event-stream/);
  expect(out.runTurn).toHaveBeenCalledOnce();
});

test("a routine run is not refused by a card an earlier run left", async () => {
  const routine = createRoutine(
    { name: "Digest", prompt: "check", schedule: "0 9 * * *" },
    "r1",
    "2026-09-29T10:00:00.000Z",
  );
  const out = await pooledTurn(
    "routine-r1",
    { actingAs: { userId: OTHER }, routine: { id: "r1" }, text: "" },
    (put) =>
      put(
        `${AGENT}/.houston/routines/routines.json`,
        JSON.stringify([routine]),
      ),
  );

  expect(out.res.status).toBe(200);
  expect(out.text).not.toContain("not_interaction_owner");
});

const actingToken = (sub: string) =>
  `acting-v1.${Buffer.from(
    JSON.stringify({ sub, exp: 9_000_000_000, via: "assistant" }),
  ).toString("base64url")}.sig`;

test("the AI Manager acting for the person the card is for runs the turn", async () => {
  const out = await pooledTurn("c1", {
    actingAs: { userId: OWNER },
    actingToken: actingToken(OWNER),
  });

  expect(out.res.status).toBe(200);
  expect(out.runTurn).toHaveBeenCalledOnce();
});

test("the AI Manager acting for another member is refused", async () => {
  const out = await pooledTurn("c1", {
    actingAs: { userId: OTHER },
    actingToken: actingToken(OTHER),
  });

  expect(out.res.status).toBe(403);
  expect(out.runTurn).not.toHaveBeenCalled();
  expect(out.turnlog).toEqual([]);
});

test("a turn with no acting identity is never refused", async () => {
  const out = await pooledTurn("c1", {});

  expect(out.res.status).toBe(200);
  expect(out.runTurn).toHaveBeenCalledOnce();
});
