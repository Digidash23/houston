import type { SequencedFrame, WireFrame } from "@houston/runtime-client";
import type { TurnServerDeps } from "./server-types";
import { postTurnLogBatch } from "./turn-log-post";
import { markTurnOnce } from "./turn-network-marks";
import { poolIdentity } from "./turn-store";
import type { TurnRequest } from "./types";

interface TurnLogOptions {
  baseUrl: string;
  org: string;
  agent: string;
  conversationId: string;
  hostToken: string;
  claim: { token: string; bootId: string };
  fetchImpl?: typeof fetch;
  batchMs?: number;
  batchSize?: number;
  /** First seq to stamp (the conversation's stream continues, never restarts). */
  seqStart?: number;
  /** Waits before each resend of a failed batch (default 500 ms, 2 s). */
  retryDelaysMs?: number[];
}

const REQUEST_TIMEOUT_MS = 5_000;

const terminal = (frame: WireFrame) =>
  frame.type === "done" || frame.type === "error";

/**
 * Posts an idle turn's first frame immediately, then coalesces frames behind an
 * active POST until it settles or the batch timer expires. These POSTs feed the
 * gateway's SSE tail, so initial batching delay is user-visible.
 */
export class TurnLog {
  private readonly fetchImpl: typeof fetch;
  private readonly batchMs: number;
  private readonly batchSize: number;
  private readonly retryDelaysMs: number[];
  private readonly frames: SequencedFrame[] = [];
  private seq: number;
  private disabled = false;
  private pendingBatches = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail = Promise.resolve();

  constructor(private readonly opts: TurnLogOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.batchMs = opts.batchMs ?? 50;
    this.batchSize = opts.batchSize ?? 32;
    this.retryDelaysMs = opts.retryDelaysMs ?? [500, 2_000];
    this.seq = (opts.seqStart ?? 1) - 1;
  }

  /** Sequence and enqueue one frame, posting immediately when the sender is idle. */
  record(frame: WireFrame): SequencedFrame {
    // SAFETY: spreading a WireFrame preserves its discriminated shape while
    // adding the sole field required by SequencedFrame.
    const sequenced = { ...frame, seq: ++this.seq } as SequencedFrame;
    if (this.disabled) return sequenced;
    if (this.pendingBatches === 0 && this.frames.length === 0) {
      this.enqueue([sequenced]);
      return sequenced;
    }
    this.frames.push(sequenced);
    if (terminal(frame) || this.frames.length >= this.batchSize) {
      this.enqueueQueued();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.enqueueQueued(), this.batchMs);
      this.timer.unref?.();
    }
    return sequenced;
  }

  /** Flush queued frames after earlier batches, swallowing logged failures. */
  async flush(): Promise<void> {
    this.enqueueQueued();
    await this.tail;
  }

  private enqueueQueued(): void {
    this.clearTimer();
    const frames = this.frames.splice(0);
    if (frames.length > 0 && !this.disabled) {
      this.enqueue(frames);
    }
  }

  private enqueue(frames: SequencedFrame[]): void {
    this.pendingBatches += 1;
    this.tail = this.tail
      .then(() => this.send(frames))
      .then(() => {
        this.pendingBatches -= 1;
        if (this.disabled) {
          this.frames.length = 0;
          this.clearTimer();
        } else if (this.frames.length > 0) {
          this.enqueueQueued();
        }
      });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async send(frames: SequencedFrame[]): Promise<void> {
    if (this.disabled) return;
    const root = this.opts.baseUrl.replace(/\/+$/, "");
    const url = `${root}/v1/pod/turnlog/${encodeURIComponent(
      this.opts.org,
    )}/${encodeURIComponent(this.opts.agent)}/${encodeURIComponent(
      this.opts.conversationId,
    )}`;
    const body = JSON.stringify(
      frames.map((frame) => ({ seq: frame.seq, frame })),
    );
    // The first text reaches the user through this POST; its queue wait and
    // round trip are the worker's half of the delivery time.
    const carriesText = frames.some((sequenced) => sequenced.type === "text");
    markTurnOnce("t_turnlog_first_post_start");
    if (carriesText) markTurnOnce("t_turnlog_text_post_start");
    // A dropped batch is a permanent seq gap: the gateway then resyncs the
    // conversation, so later frames (the terminal too) never reach the client
    // in order. Resend like the standing pod's sender.
    for (let attempt = 0; ; attempt++) {
      const result = await postTurnLogBatch({
        fetchImpl: this.fetchImpl,
        url,
        init: {
          headers: {
            Authorization: `Bearer ${this.opts.hostToken}`,
            "Content-Type": "application/json",
            "X-Houston-Claim-Token": this.opts.claim.token,
            "X-Houston-Claim-Boot": this.opts.claim.bootId,
          },
          body,
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
        carriesText,
      });
      if (result === "route_absent") {
        this.disabled = true;
        console.debug("[turnlog] gateway route unavailable for this turn");
        return;
      }
      const delay = this.retryDelaysMs[attempt];
      if (result !== "retry" || delay === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** Create a claim-authorized sender when this non-shadow turn enables it. */
export function createTurnLog(
  deps: TurnServerDeps,
  turn: TurnRequest,
): TurnLog | null {
  const baseUrl = deps.turnLogUrl ?? process.env.HOUSTON_TURNLOG_URL;
  if (turn.shadow || !baseUrl || !turn.claim || !turn.hostToken) return null;
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  return new TurnLog({
    baseUrl,
    org,
    agent,
    conversationId: turn.conversationId,
    hostToken: turn.hostToken,
    claim: { token: turn.claim.token, bootId: turn.claim.bootId },
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(turn.turnlogSeqStart ? { seqStart: turn.turnlogSeqStart } : {}),
  });
}
