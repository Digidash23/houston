/**
 * The live view's upward half: the person's input events and the viewer's
 * frame acks, batched into input POSTs with at most one in flight. Order is
 * the person's order; what can merge without changing the outcome does
 * (adjacent moves, adjacent wheel turns, adjacent typed text).
 */

import {
  BROWSER_LIVE_MAX_EVENTS,
  BROWSER_LIVE_MAX_TEXT,
  type BrowserLiveInput,
  type BrowserLiveInputAnswer,
  type BrowserLiveInputRequest,
} from "@houston/wire-types";
import type { Clock } from "../../ports";
import { type BrowserLiveFailure, classifyLiveFailure } from "./live-failure";

/** Pause before re-sending a batch whose POST got no usable answer. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;

export interface InputBatcherDeps {
  viewer: string;
  post(request: BrowserLiveInputRequest): Promise<BrowserLiveInputAnswer>;
  clock: Clock;
  isTransport(err: unknown): boolean;
  /** Every answer's state; anything but `waiting` ends the connection. */
  onAnswer(answer: BrowserLiveInputAnswer): void;
  onEnded(failure: Extract<BrowserLiveFailure, { kind: "ended" }>): void;
  onUnexpected(error: unknown): void;
}

function isMove(event: BrowserLiveInput): boolean {
  return event.type === "mouse" && event.action === "move";
}

/** `next` folded into the queue's tail, or `null` when it must stay its own event. */
function merged(
  last: BrowserLiveInput,
  next: BrowserLiveInput,
): BrowserLiveInput | null {
  if (isMove(last) && isMove(next)) return next;
  if (last.type === "wheel" && next.type === "wheel")
    return { ...next, dx: last.dx + next.dx, dy: last.dy + next.dy };
  if (
    last.type === "text" &&
    next.type === "text" &&
    last.text.length + next.text.length <= BROWSER_LIVE_MAX_TEXT
  )
    return { type: "text", text: last.text + next.text };
  return null;
}

export function createInputBatcher(deps: InputBatcherDeps) {
  let queue: BrowserLiveInput[] = [];
  let received: number | null = null;
  let acked: number | null = null;
  /** How many events at the queue's head the POST in flight carries. */
  let inFlight: number | null = null;
  let stopped = false;
  let failures = 0;
  let retryTimer: number | null = null;
  let finish: "done" | "cancel" | null = null;
  const finishWaiters: (() => void)[] = [];

  const settleFinish = () => {
    for (const resolve of finishWaiters.splice(0)) resolve();
  };

  const nextRequest = (): BrowserLiveInputRequest | null => {
    const events = queue.slice(0, BROWSER_LIVE_MAX_EVENTS);
    const request: BrowserLiveInputRequest = {};
    if (events.length) request.events = events;
    if (received !== null && received !== acked)
      request.ack = { viewer: deps.viewer, seq: received };
    if (finish && events.length === queue.length) request.finish = finish;
    return request.events || request.ack || request.finish ? request : null;
  };

  const retryLater = () => {
    // Pointer moves are stale by the time a retry lands (every press carries
    // its own position); only a trailing one still says where the pointer is.
    queue = queue.filter((e, i) => !isMove(e) || i === queue.length - 1);
    const pause = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures += 1;
    retryTimer = deps.clock.setTimeout(() => {
      retryTimer = null;
      pump();
    }, pause);
  };

  const pump = (): void => {
    if (stopped || inFlight !== null || retryTimer !== null) return;
    const request = nextRequest();
    if (!request) return;
    const sent = request.events ?? [];
    inFlight = sent.length;
    deps.post(request).then(
      (answer) => {
        inFlight = null;
        failures = 0;
        if (request.ack) acked = Math.max(acked ?? 0, request.ack.seq);
        queue = queue.slice(sent.length);
        if (request.finish) {
          finish = null;
          settleFinish();
        }
        deps.onAnswer(answer);
        pump();
      },
      (err: unknown) => {
        inFlight = null;
        if (stopped) return;
        const failure = classifyLiveFailure(err, deps.isTransport);
        if (failure.kind === "transient") return retryLater();
        if (failure.kind === "ended") return deps.onEnded(failure);
        // A batch the runtime refused as malformed would be refused again.
        deps.onUnexpected(err);
        queue = queue.slice(sent.length);
        if (request.finish) {
          finish = null;
          settleFinish();
        }
        pump();
      },
    );
  };

  return {
    send(event: BrowserLiveInput): void {
      if (stopped) return;
      // Never fold into an event the POST in flight already carries.
      const last = queue.length > (inFlight ?? 0) ? queue.at(-1) : undefined;
      const fold = last ? merged(last, event) : null;
      if (fold) queue[queue.length - 1] = fold;
      else queue.push(event);
      pump();
    },
    /** The highest frame `seq` received; rides the next POST. */
    ack(seq: number): void {
      if (received === null || seq > received) received = seq;
      pump();
    },
    finish(outcome: "done" | "cancel"): Promise<void> {
      if (stopped) return Promise.resolve();
      finish = outcome;
      const done = new Promise<void>((resolve) => finishWaiters.push(resolve));
      pump();
      return done;
    },
    /** Stop sending; a pending `finish` resolves (the hand-off answered or is out of reach). */
    stop(): void {
      stopped = true;
      queue = [];
      if (retryTimer !== null) deps.clock.clearTimeout(retryTimer);
      retryTimer = null;
      settleFinish();
    },
  };
}

export type InputBatcher = ReturnType<typeof createInputBatcher>;
