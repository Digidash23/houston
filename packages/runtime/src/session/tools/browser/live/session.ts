import type {
  BrowserHandoffEnd,
  BrowserHandoffState,
  BrowserLiveEvent,
  BrowserLiveFrame,
  BrowserLiveInput,
  BrowserLiveLayout,
  BrowserLivePage,
  BrowserLiveStatus,
} from "@houston/wire-types";
import type { BrowserTab } from "../open-tab";
import { type InputOutcome, LiveInput } from "./input";
import { applyLayout } from "./layout";
import { warnUnlessClosed } from "./page-errors";
import { Screencast } from "./screencast";
import { ViewerWindow } from "./viewer-window";

export interface HandoffInit {
  conversationId: string;
  /** What the person needs to do, as the agent put it. */
  text: string;
  /** The signed-in person who may drive it; undefined = anyone (desktop). */
  owner?: string;
  tab: BrowserTab;
  limitMs: number;
  /** Called on every input batch, so an idle sweep spares a page in use. */
  touch?: () => void;
  now?: () => number;
}

/**
 * One hand-off: the agent's `browser` call waits on `ended` while the person
 * drives the tab through any number of viewers. Ends exactly once: done or
 * cancelled by the person, cancelled by a stopped turn, or expired.
 */
export class HandoffSession {
  readonly conversationId: string;
  readonly text: string;
  readonly owner: string | undefined;
  readonly expiresAt: number;
  readonly tab: BrowserTab;
  readonly ended: Promise<BrowserHandoffEnd>;
  state: BrowserHandoffState = "waiting";
  private settle: (end: BrowserHandoffEnd) => void = () => undefined;
  private readonly viewers = new Map<string, ViewerWindow>();
  private readonly screencast: Screencast;
  private readonly input: LiveInput;
  private readonly touch: () => void;
  private readonly deadline: NodeJS.Timeout;
  private latestFrame: BrowserLiveFrame | null = null;
  private latestPage: BrowserLivePage | null = null;
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** The highest input batch seq applied per viewer (a retry is not re-applied). */
  private readonly applied = new Map<string, number>();

  constructor(init: HandoffInit) {
    this.conversationId = init.conversationId;
    this.text = init.text;
    this.owner = init.owner;
    this.tab = init.tab;
    this.touch = init.touch ?? (() => undefined);
    this.expiresAt = (init.now ?? Date.now)() + init.limitMs;
    this.ended = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.input = new LiveInput(init.tab);
    this.screencast = new Screencast(init.tab, {
      frame: (frame) => this.broadcastFrame(frame),
      page: (page) => this.broadcastPage(page),
    });
    this.deadline = setTimeout(() => this.finish("expired"), init.limitMs);
    // A hand-off nobody finishes must never be what keeps a process alive.
    this.deadline.unref();
  }

  status(): BrowserLiveStatus {
    return {
      type: "status",
      state: this.state,
      text: this.text,
      expiresAt: this.expiresAt,
    };
  }

  /** End the hand-off; later calls change nothing. */
  finish(end: BrowserHandoffEnd): void {
    if (this.state !== "waiting") return;
    this.state = end;
    clearTimeout(this.deadline);
    this.screencast.stop();
    this.input.close().catch(warnUnlessClosed("input close"));
    const status = this.status();
    for (const viewer of this.viewers.values()) viewer.event(status);
    this.viewers.clear();
    this.settle(end);
  }

  /**
   * Start sending one viewer the status, the page, the latest frame, then live
   * frames. A viewer id that reconnects replaces its old stream. Returns the
   * detach for when the stream closes.
   */
  attachViewer(
    viewer: string,
    layout: BrowserLiveLayout,
    write: (event: BrowserLiveEvent) => boolean,
  ): () => void {
    const stream = new ViewerWindow(write);
    stream.event(this.status());
    if (this.state !== "waiting") return () => undefined;
    this.viewers.set(viewer, stream);
    if (this.latestPage) stream.event(this.latestPage);
    if (this.latestFrame) stream.frame(this.latestFrame);
    if (layout !== this.tab.layout)
      applyLayout(this.tab, layout).catch(warnUnlessClosed("layout"));
    this.screencast.start();
    return () => {
      if (this.viewers.get(viewer) !== stream) return;
      this.viewers.delete(viewer);
      if (this.viewers.size === 0) this.screencast.stop();
    };
  }

  ack(viewer: string, seq: number): void {
    this.viewers.get(viewer)?.ack(seq);
  }

  /**
   * Apply one input batch, in order, after every earlier batch. A batch that
   * was queued when the hand-off ended, or that repeats one already applied
   * for its viewer (`batch.seq` not above the last), applies nothing.
   */
  apply(
    events: readonly BrowserLiveInput[],
    batch?: { viewer: string; seq: number },
  ): Promise<InputOutcome> {
    const run = this.chain.then((): InputOutcome | Promise<InputOutcome> => {
      if (this.state !== "waiting" || !this.firstApply(batch)) return {};
      this.touch();
      return this.input.apply(events);
    });
    // The chain only orders batches; each caller gets its own batch's failure.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Records `batch` as applied and says whether it is new. Recorded before the
   * events run: a batch that failed halfway is not typed a second time.
   */
  private firstApply(batch?: { viewer: string; seq: number }): boolean {
    if (!batch) return true;
    if (batch.seq <= (this.applied.get(batch.viewer) ?? 0)) return false;
    this.applied.set(batch.viewer, batch.seq);
    return true;
  }

  private broadcastFrame(shot: Omit<BrowserLiveFrame, "type" | "seq">): void {
    this.seq += 1;
    const frame: BrowserLiveFrame = { type: "frame", seq: this.seq, ...shot };
    this.latestFrame = frame;
    for (const viewer of this.viewers.values()) viewer.frame(frame);
  }

  private broadcastPage(page: { url: string; title: string }): void {
    const event: BrowserLivePage = { type: "page", ...page };
    this.latestPage = event;
    for (const viewer of this.viewers.values()) viewer.event(event);
  }
}
