import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_AGENT_ID } from "./config";
import { type FakeHost, startFakeHost } from "./server";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * The mid-turn specs (drop, turn boundary, kill) need the turn still running
 * when they act, however slowly the client renders its first delta. With the
 * hold armed, a turn paced far faster than the wait below is still running.
 */
describe("chat-config holdAfterFirstDelta", () => {
  let host: FakeHost;
  const post = (path: string, body?: unknown) =>
    fetch(`${host.url}${path}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const convo = (cid: string) =>
    `/agents/${SEED_AGENT_ID}/conversations/${cid}`;
  const history = async (cid: string) =>
    (
      (await (await fetch(`${host.url}${convo(cid)}/messages`)).json()) as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(async () => {
    host = await startFakeHost(0);
    await post("/__test__/reset");
  });
  afterEach(async () => {
    await host.stop();
  });

  it("keeps the turn running until a kill, which then finds it", async () => {
    await post("/__test__/chat-config", {
      replyDelayMs: 5,
      holdAfterFirstDelta: true,
    });
    await post(`${convo("hold-kill")}/messages`, { text: "hold me" });
    await settle(300);
    const res = await post("/__test__/kill-turn");
    expect(((await res.json()) as { killed: number }).killed).toBe(1);
  });

  it("a drop releases the held turn, which then finishes into history", async () => {
    await post("/__test__/chat-config", {
      replyDelayMs: 5,
      holdAfterFirstDelta: true,
    });
    await post(`${convo("hold-drop")}/messages`, { text: "hold me" });
    await settle(300);
    expect(
      (await history("hold-drop")).some((m) => m.role === "assistant"),
    ).toBe(false);
    await post("/__test__/drop-chat-streams");
    await settle(300);
    const reply = (await history("hold-drop")).find(
      (m) => m.role === "assistant",
    );
    expect(reply?.content).toMatch(/You said: .hold me./);
  });

  it("holds one turn only: the next turn runs free", async () => {
    await post("/__test__/chat-config", {
      replyDelayMs: 5,
      holdAfterFirstDelta: true,
    });
    await post(`${convo("hold-one")}/messages`, { text: "first" });
    await post("/__test__/drop-chat-streams");
    await settle(300);
    await post(`${convo("hold-two")}/messages`, { text: "second" });
    await settle(300);
    expect(
      (await history("hold-two")).some((m) => m.role === "assistant"),
    ).toBe(true);
  });
});
