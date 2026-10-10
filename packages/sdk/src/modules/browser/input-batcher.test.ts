import { describe, expect, it } from "vitest";
import { flush, httpError, liveHarness } from "./live-test-kit";

const move = (x: number) =>
  ({ type: "mouse", action: "move", x, y: 0.5 }) as const;
const frame = (seq: number) =>
  ({ type: "frame", seq, jpeg: "AAA", width: 1, height: 1 }) as const;

describe("the browser live connection's input", () => {
  it("keeps one POST in flight and coalesces what queues behind it", async () => {
    const h = liveHarness();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send(move(0.1));
    h.connection.send(move(0.2));
    h.connection.send({ type: "wheel", x: 0.1, y: 0.1, dx: 0, dy: 10 });
    h.connection.send({ type: "wheel", x: 0.3, y: 0.3, dx: 5, dy: 20 });
    h.connection.send({ type: "text", text: "b" });
    h.connection.send({ type: "text", text: "c" });
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].request).toEqual({
      events: [{ type: "text", text: "a" }],
    });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      events: [
        move(0.2),
        { type: "wheel", x: 0.3, y: 0.3, dx: 5, dy: 30 },
        { type: "text", text: "bc" },
      ],
    });
  });

  it("never folds into the batch already on the wire", async () => {
    const h = liveHarness();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send({ type: "text", text: "b" });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      events: [{ type: "text", text: "b" }],
    });
  });

  it("caps a batch at 64 events", async () => {
    const h = liveHarness();
    h.connection.send({ type: "back" });
    for (let i = 0; i < 70; i++) h.connection.send({ type: "back" });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request.events).toHaveLength(64);
    h.posts[1].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[2].request.events).toHaveLength(6);
  });

  it("sends the frame ack alone when nothing is queued, else with the next batch", async () => {
    const h = liveHarness();
    h.streams[0].onEvent(frame(1));
    expect(h.posts[0].request).toEqual({
      ack: { viewer: "viewer_12345", seq: 1 },
    });
    h.streams[0].onEvent(frame(2));
    h.streams[0].onEvent(frame(3));
    h.connection.send({ type: "back" });
    expect(h.posts).toHaveLength(1);
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      events: [{ type: "back" }],
      ack: { viewer: "viewer_12345", seq: 3 },
    });
    h.posts[1].resolve({ state: "waiting" });
    await flush();
    expect(h.posts).toHaveLength(2);
  });

  it("keeps the queue through a network failure, dropping stale moves", async () => {
    const h = liveHarness();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send(move(0.1));
    h.connection.send({ type: "back" });
    h.connection.send(move(0.2));
    h.posts[0].reject(new TypeError("Failed to fetch"));
    await flush();
    h.connection.send({ type: "back" });
    await h.advance(499);
    expect(h.posts).toHaveLength(1);
    await h.advance(1);
    expect(h.posts[1].request.events).toEqual([
      { type: "text", text: "a" },
      { type: "back" },
      move(0.2),
      { type: "back" },
    ]);
    expect(h.handlers.onUnexpected).not.toHaveBeenCalled();
  });

  it("finish flushes queued input first and resolves on the answer", async () => {
    const h = liveHarness();
    h.connection.send({ type: "text", text: "a" });
    h.connection.send({ type: "key", key: "Enter" });
    let finished = false;
    const done = h.connection.finish("done").then(() => {
      finished = true;
    });
    h.posts[0].resolve({ state: "waiting" });
    await flush();
    expect(h.posts[1].request).toEqual({
      events: [{ type: "key", key: "Enter" }],
      finish: "done",
    });
    expect(finished).toBe(false);
    h.posts[1].resolve({ state: "done" });
    await done;
    expect(h.states.at(-1)).toEqual({ kind: "ended", reason: "done" });
  });

  it("a 409 resolves finish and ends with the state the runtime names", async () => {
    const h = liveHarness();
    const done = h.connection.finish("cancel");
    h.posts[0].reject(
      httpError(409, '{"error":"handoff_ended","state":"expired"}'),
    );
    await done;
    expect(h.states.at(-1)).toEqual({ kind: "ended", reason: "expired" });
    expect(h.handlers.onUnexpected).not.toHaveBeenCalled();
  });

  it("reports a 400 and drops that batch", async () => {
    const h = liveHarness();
    h.connection.send({ type: "back" });
    h.connection.send({ type: "text", text: "x" });
    const refusal = httpError(400, '{"error":"invalid_input"}');
    h.posts[0].reject(refusal);
    await flush();
    expect(h.handlers.onUnexpected).toHaveBeenCalledWith(refusal);
    expect(h.posts[1].request).toEqual({
      events: [{ type: "text", text: "x" }],
    });
  });

  it("passes a refused navigate to the surface and keeps going", async () => {
    const h = liveHarness();
    h.connection.send({ type: "navigate", url: "file:///etc" });
    h.posts[0].resolve({ state: "waiting", refused: "url_refused" });
    await flush();
    expect(h.handlers.onRefused).toHaveBeenCalledWith("url_refused");
    expect(h.states.at(-1)).toEqual({ kind: "connecting" });
  });
});
