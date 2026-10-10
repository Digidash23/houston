import {
  BROWSER_LIVE_FRAME_WINDOW,
  type BrowserLiveEvent,
  type BrowserLiveFrame,
} from "@houston/wire-types";

/**
 * One viewer's share of the frame stream. The host's SSE pipe never waits for
 * a slow socket to drain, so a phone on a weak link is paced by its own acks:
 * at most {@link BROWSER_LIVE_FRAME_WINDOW} frames go out unacknowledged, and
 * a frame that arrives while the window is full replaces the one held back,
 * so the viewer always catches up to the newest picture, never a backlog.
 */
export class ViewerWindow {
  private unacked: number[] = [];
  private held: BrowserLiveFrame | null = null;

  constructor(private readonly write: (event: BrowserLiveEvent) => boolean) {}

  event(event: BrowserLiveEvent): void {
    this.write(event);
  }

  frame(frame: BrowserLiveFrame): void {
    if (this.unacked.length < BROWSER_LIVE_FRAME_WINDOW) this.send(frame);
    else this.held = frame;
  }

  /** The viewer has every frame up to `seq`. */
  ack(seq: number): void {
    this.unacked = this.unacked.filter((sent) => sent > seq);
    const held = this.held;
    if (held && this.unacked.length < BROWSER_LIVE_FRAME_WINDOW) {
      this.held = null;
      this.send(held);
    }
  }

  private send(frame: BrowserLiveFrame): void {
    if (this.write(frame)) this.unacked.push(frame.seq);
  }
}
