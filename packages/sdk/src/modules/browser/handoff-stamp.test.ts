import { describe, expect, it } from "vitest";
import { flush, HANDOFF, liveHarness } from "./live-test-kit";

const frame = (seq: number) =>
  ({ type: "frame", seq, jpeg: "AAA", width: 1, height: 1 }) as const;

describe("the live view names its hand-off on everything it sends", () => {
  it("sends nothing, not even a finish, before a status names the hand-off", async () => {
    const h = liveHarness();
    h.connection.send({ type: "back" });
    let result: string | null = null;
    const done = h.connection.finish("done").then((r) => {
      result = r;
    });
    await flush();
    expect(h.posts).toHaveLength(0);
    expect(result).toBeNull();
    h.known();
    expect(h.posts[0].request).toEqual({
      handoff: HANDOFF,
      events: [{ type: "back" }],
      batch: { viewer: "viewer_12345", seq: 1 },
      finish: "done",
    });
    h.posts[0].resolve({ state: "done" });
    await done;
    expect(result).toBe("answered");
  });

  it("a view closed before any status abandons its finish, sending nothing", async () => {
    const h = liveHarness();
    const done = h.connection.finish("cancel");
    h.connection.close();
    await expect(done).resolves.toBe("abandoned");
    expect(h.posts).toHaveLength(0);
  });

  it("stamps the event lane, the ack lane and the finish alike", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "back" });
    h.streams[0].onEvent(frame(1));
    await h.advance(250);
    const finished = h.connection.finish("cancel");
    h.posts[0].resolve({ state: "waiting" });
    h.posts[1].resolve({ state: "waiting" });
    await flush();
    h.posts[2].resolve({ state: "cancelled" });
    await expect(finished).resolves.toBe("answered");
    expect(h.posts.map((p) => p.request.handoff)).toEqual([
      HANDOFF,
      HANDOFF,
      HANDOFF,
    ]);
    expect(h.posts[2].request.finish).toBe("cancel");
  });

  it("reconnects on the hand-off its first status named", async () => {
    const h = liveHarness();
    expect(h.streams[0].handoff).toBeUndefined();
    h.known();
    h.streams[0].resolve();
    await flush();
    await h.advance(500);
    expect(h.streams[1].handoff).toBe(HANDOFF);
  });

  it("a stream that names another hand-off ends the view: its own is over", async () => {
    const h = liveHarness();
    h.known();
    h.streams[0].resolve();
    await flush();
    await h.advance(500);
    h.known("handoff-2");
    expect(h.states.at(-1)).toEqual({ kind: "ended", reason: "none" });
    expect(h.handlers.onStatus).toHaveBeenCalledTimes(1);
  });
});
