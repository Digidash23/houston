/**
 * The browser hand-off half of {@link HoustonEngineClient}: the live view a
 * person watches while the agent's `browser` tool waits on a `handoff`, and the
 * input batches they drive it with.
 *
 * Split out of `./client.ts` for size, not for reach, like the other `client-*`
 * bases. It needs the raw {@link request} as well as {@link json}: the live view
 * is an SSE body read frame by frame. Frames stay untyped here; the SDK parses
 * them with `@houston/wire-types`' strict parser.
 */

import { EngineConversationsClient } from "./client-conversations";
import { EngineError } from "./requester";
import { readEventStream } from "./sse-read";

export interface BrowserLiveStreamOptions {
  signal: AbortSignal;
  onFrame: (raw: unknown) => void;
  /** Every received chunk, heartbeats included. */
  onActivity?: () => void;
}

export abstract class EngineBrowserClient extends EngineConversationsClient {
  /** The concrete client's raw transport (non-2xx throws `EngineError`). */
  protected abstract request(
    path: string,
    init?: RequestInit,
  ): Promise<Response>;

  /**
   * One connection attempt; resolves when the stream ends. `viewer` names this
   * viewer (frame acks are counted per viewer); `handoff`, once the first
   * status named it, keeps a reconnect on that hand-off. Viewer, layout and
   * handoff are positional so the assistant catalog can derive the query from
   * the SDK operation's own parameters.
   */
  async streamBrowserLive(
    id: string,
    viewer: string,
    layout: "desktop" | "phone",
    handoff: string | undefined,
    opts: BrowserLiveStreamOptions,
  ): Promise<void> {
    const query = new URLSearchParams();
    query.set("viewer", viewer);
    query.set("layout", layout);
    if (handoff !== undefined) query.set("handoff", handoff);
    const suffix = query.toString();
    const res = await this.request(
      `/conversations/${encodeURIComponent(id)}/browser/live${suffix ? `?${suffix}` : ""}`,
      // No Accept header: the host proxy keys SSE on the response's content
      // type, and a header beyond the JSON one leaves the route underivable
      // for the assistant catalog (and so unbound for the parity gate).
      { method: "GET", signal: opts.signal },
    );
    if (!res.body)
      throw new EngineError(0, "no response body for browser live stream");
    await readEventStream(res.body, opts.onFrame, opts.onActivity);
  }

  /** One input batch (events, frame ack, finish); the answer is unparsed. */
  browserInput(id: string, body: unknown) {
    return this.json<unknown>(
      `/conversations/${encodeURIComponent(id)}/browser/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }
}
