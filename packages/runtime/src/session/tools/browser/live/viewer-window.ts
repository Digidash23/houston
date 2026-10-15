import {
  BROWSER_LIVE_FRAME_WINDOW,
  BROWSER_LIVE_FRAME_WINDOW_BYTES,
  type BrowserLiveEvent,
  type BrowserLiveFrame,
  type BrowserLiveWindow,
} from "@houston/wire-types";

/** The window every viewer gets, advertised on each status. */
export const VIEWER_WINDOW: BrowserLiveWindow = {
  frames: BROWSER_LIVE_FRAME_WINDOW,
  bytes: BROWSER_LIVE_FRAME_WINDOW_BYTES,
};

/**
 * One viewer's share of the frame stream. The host's SSE pipe never waits for
 * a slow socket to drain, so a phone on a weak link is paced by its own acks:
 * a frame goes out only while the unacked frames stay within the window's
 * count AND bytes (base64 length), and a frame that arrives while it is full
 * replaces the one held back, so the viewer always catches up to the newest
 * picture, never a backlog. A frame bigger than the whole byte window still
 * goes once nothing is unacked, or the picture would freeze for good.
 */
export class ViewerWindow {
  private unacked: { seq: number; bytes: number }[] = [];
  private held: BrowserLiveFrame | null = null;

  constructor(
    private readonly write: (event: BrowserLiveEvent) => boolean,
    private readonly window: BrowserLiveWindow = VIEWER_WINDOW,
  ) {}

  event(event: BrowserLiveEvent): void {
    this.write(event);
  }

  frame(frame: BrowserLiveFrame): void {
    if (this.fits(frame)) this.send(frame);
    else this.held = frame;
  }

  /**
   * The latest picture, sent once to a viewer that just attached. Not counted
   * against the window: a reconnecting viewer already received that seq and
   * never acks it again, so counting it would hold every later frame back
   * once frames are big enough to fill the byte window.
   */
  replay(frame: BrowserLiveFrame): void {
    this.write(frame);
  }

  /** The viewer has every frame up to `seq`. */
  ack(seq: number): void {
    this.unacked = this.unacked.filter((sent) => sent.seq > seq);
    const held = this.held;
    if (held && this.fits(held)) {
      this.held = null;
      this.send(held);
    }
  }

  private fits(frame: BrowserLiveFrame): boolean {
    if (this.unacked.length === 0) return true;
    if (this.unacked.length >= this.window.frames) return false;
    const inFlight = this.unacked.reduce((sum, sent) => sum + sent.bytes, 0);
    return inFlight + frame.jpeg.length <= this.window.bytes;
  }

  private send(frame: BrowserLiveFrame): void {
    if (this.write(frame))
      this.unacked.push({ seq: frame.seq, bytes: frame.jpeg.length });
  }
}
