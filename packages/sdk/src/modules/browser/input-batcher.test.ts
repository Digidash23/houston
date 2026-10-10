import { describe, expect, it } from "vitest";
import { flush, HANDOFF, httpError, liveHarness } from "./live-test-kit";

const move = (x: number) =>
  ({ type: "mouse", action: "move", x, y: 0.5 }) as const;
const frame = (seq: number) =>
  ({ type: "frame", seq, jpeg: "AAA", width: 1, height: 1 }) as const;
const batch = (seq: number) => ({ viewer: "viewer_12345", seq });
const ack = (seq: number) => ({ viewer: "viewer_12345", seq });

describe("the browser live connection's input", () => {
  it("keeps one event batch in flight and coalesces what queues behind it", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send(move(0.1));
    h.connection.send(move(0.2));
    h.connection.send({ type: "wheel", x: 0.1, y: 0.1, dx: 0, dy: 10 });
    h.connection.send({ type: "wheel", x: 0.3, y: 0.3, dx: 5, dy: 20 });
    h.connection.send({ type: "text", text: "b" });
    h.connection.send({ type: "text", text: "c" });
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].request).toEqual({
      handoff: HANDOFF,
      events: [{ type: "text", text: "a" }],
      batch: batch(1),
    });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      handoff: HANDOFF,
      events: [
        move(0.2),
        { type: "wheel", x: 0.3, y: 0.3, dx: 5, dy: 30 },
        { type: "text", text: "bc" },
      ],
      batch: batch(2),
    });
  });

  it("never folds into the batch already on the wire", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send({ type: "text", text: "b" });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request.events).toEqual([{ type: "text", text: "b" }]);
  });

  it("caps a batch at 64 events", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "back" });
    for (let i = 0; i < 70; i++) h.connection.send({ type: "back" });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request.events).toHaveLength(64);
    h.posts[1].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[2].request.events).toHaveLength(6);
    expect(h.posts.map((p) => p.request.batch?.seq)).toEqual([1, 2, 3]);
  });

  it("acks alone on its own lane, or rides an event batch about to go", async () => {
    const h = liveHarness();
    h.known();
    h.streams[0].onEvent(frame(1));
    expect(h.posts[0].request).toEqual({ handoff: HANDOFF, ack: ack(1) });
    h.streams[0].onEvent(frame(2));
    h.streams[0].onEvent(frame(3));
    expect(h.posts).toHaveLength(1);
    h.connection.send({ type: "back" });
    expect(h.posts[1].request).toEqual({
      handoff: HANDOFF,
      events: [{ type: "back" }],
      batch: batch(1),
      ack: ack(3),
    });
    h.posts[0].resolve({ state: "waiting" });
    h.posts[1].resolve({ state: "waiting" });
    await flush();
    expect(h.posts).toHaveLength(2);
  });

  it("an ack does not wait behind a stuck event batch", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "back" });
    h.streams[0].onEvent(frame(7));
    expect(h.posts[1].request).toEqual({ handoff: HANDOFF, ack: ack(7) });
  });

  it("finish flushes queued input first and resolves answered", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send({ type: "key", key: "Enter" });
    let result: string | null = null;
    const done = h.connection.finish("done").then((r) => {
      result = r;
    });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      handoff: HANDOFF,
      events: [{ type: "key", key: "Enter" }],
      batch: batch(2),
      finish: "done",
    });
    expect(result).toBeNull();
    h.posts[1].resolve({ state: "done" });
    await done;
    expect(result).toBe("answered");
    expect(h.states.at(-1)).toEqual({ kind: "ended", reason: "done" });
  });

  it("a 409 resolves finish as answered and ends with the state the runtime names", async () => {
    const h = liveHarness();
    h.known();
    const done = h.connection.finish("cancel");
    h.posts[0].reject(
      httpError(409, '{"error":"handoff_ended","state":"expired"}'),
    );
    await expect(done).resolves.toBe("answered");
    expect(h.states.at(-1)).toEqual({ kind: "ended", reason: "expired" });
    expect(h.handlers.onUnexpected).not.toHaveBeenCalled();
  });

  it("close settles a pending finish as abandoned, not delivered", async () => {
    const h = liveHarness();
    h.known();
    const done = h.connection.finish("done");
    h.connection.close();
    await expect(done).resolves.toBe("abandoned");
    await expect(h.connection.finish("done")).resolves.toBe("abandoned");
  });

  it("passes a refused navigate to the surface and keeps going", async () => {
    const h = liveHarness();
    h.known();
    h.connection.send({ type: "navigate", url: "file:///etc" });
    h.posts[0].resolve({ state: "waiting", refused: "url_refused" });
    await flush();
    expect(h.handlers.onRefused).toHaveBeenCalledWith("url_refused");
    expect(h.states.at(-1)).toEqual({ kind: "live" });
  });
});
