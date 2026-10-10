/**
 * The live view's upward half: the person's input events and the viewer's
 * frame acks, batched into input POSTs. Nothing is sent before the stream's
 * first status names the hand-off (`known`); every POST then carries it, so
 * none can act on a later hand-off in the same chat. Event batches go one at
 * a time, in the person's order, each stamped `batch: { viewer, seq }`; a
 * retry re-sends the same seq so a batch the runtime already applied is not
 * applied twice. A frame ack never waits behind a stuck batch: it goes alone
 * on its own lane. Every POST times out after `BROWSER_LIVE_INPUT_TIMEOUT_MS`,
 * as a network failure would.
 */

import type {
  BrowserLiveInput,
  BrowserLiveInputAnswer,
  BrowserLiveInputRequest,
} from "@houston/wire-types";
import type { Clock } from "../../ports";
import { finishWaiters } from "./finish-waiters";
import {
  backOff,
  clearLane,
  type InputLane,
  inputLane,
  timedPost,
} from "./input-lane";
import { batchSize, forRetry, merged, textEvents } from "./input-queue";
import { type BrowserLiveFailure, classifyLiveFailure } from "./live-failure";
import type { BrowserLiveFinishResult } from "./types";

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

export function createInputBatcher(deps: InputBatcherDeps) {
  const { clock } = deps;
  let queue: BrowserLiveInput[] = [];
  /** The event batch on the wire or waiting to be re-sent, frozen with its seq. */
  let batch: { seq: number; events: BrowserLiveInput[] } | null = null;
  let nextSeq = 1;
  let received = 0;
  let acked = 0;
  let stopped = false;
  /** The hand-off every POST names; null until the first status names it. */
  let handoff: string | null = null;
  const finish = finishWaiters();
  const events = inputLane();
  const acks = inputLane();

  const ackDue = () => {
    const covered = Math.max(acked, events.ack ?? 0, acks.ack ?? 0);
    return received > covered ? received : null;
  };

  /**
   * Sends `request` on `l`. `onSent` runs on an answer, `onRefused` when the
   * runtime refused it as malformed; either way the lane then moves on (after
   * a pause when it failed). A transient failure keeps everything for a retry.
   */
  const send = (
    l: InputLane,
    request: BrowserLiveInputRequest,
    onSent: () => void,
    onRefused: () => void,
  ) => {
    l.busy = true;
    l.ack = request.ack?.seq ?? null;
    timedPost(deps.post, clock, request).then(
      (answer) => {
        l.busy = false;
        l.ack = null;
        // Closed meanwhile: a late answer must not reach a reopened view.
        if (stopped) return;
        l.failures = 0;
        l.reported = false;
        if (request.ack) acked = Math.max(acked, request.ack.seq);
        onSent();
        deps.onAnswer(answer);
        pump();
      },
      (err: unknown) => {
        l.busy = false;
        l.ack = null;
        if (stopped) return;
        const failure = classifyLiveFailure(err, deps.isTransport);
        if (failure.kind === "ended") {
          // The hand-off is over: nothing is left to deliver a finish to.
          finish.settle("answered");
          return deps.onEnded(failure);
        }
        if (failure.kind === "unexpected") {
          // Refused as malformed: re-sending would be refused again.
          if (!l.reported) deps.onUnexpected(err);
          l.reported = true;
          onRefused();
        } else if (l === events && batch) {
          batch.events = forRetry(batch.events);
        }
        backOff(l, clock, pump);
      },
    );
  };

  const pumpEvents = (handoff: string) => {
    if (events.busy || events.timer !== null) return;
    if (!batch && queue.length > 0)
      batch = { seq: nextSeq++, events: queue.splice(0, batchSize(queue)) };
    const finishing = queue.length === 0 ? finish.pending() : null;
    if (!batch && !finishing) return;
    const request: BrowserLiveInputRequest = { handoff };
    if (batch) {
      request.events = batch.events;
      request.batch = { viewer: deps.viewer, seq: batch.seq };
    }
    const ack = ackDue();
    if (ack !== null) request.ack = { viewer: deps.viewer, seq: ack };
    if (finishing) request.finish = finishing;
    const settled = (result: BrowserLiveFinishResult) => () => {
      if (request.events) batch = null;
      if (request.finish) finish.settle(result);
    };
    send(events, request, settled("answered"), settled("abandoned"));
  };

  const pumpAck = (handoff: string) => {
    if (acks.busy || acks.timer !== null) return;
    const ack = ackDue();
    if (ack === null) return;
    send(
      acks,
      { handoff, ack: { viewer: deps.viewer, seq: ack } },
      () => {},
      // A refused ack is not re-sent; the next frame's ack supersedes it.
      () => {
        acked = Math.max(acked, ack);
      },
    );
  };

  function pump(): void {
    if (stopped || handoff === null) return;
    pumpEvents(handoff);
    pumpAck(handoff);
  }

  return {
    send(event: BrowserLiveInput): void {
      if (stopped) return;
      const parts = event.type === "text" ? textEvents(event.text) : [event];
      for (const part of parts) {
        const last = queue.at(-1);
        const fold = last ? merged(last, part) : null;
        if (fold) queue[queue.length - 1] = fold;
        else queue.push(part);
      }
      pump();
    },
    /** The hand-off the stream's first status named: sending starts. */
    known(id: string): void {
      handoff ??= id;
      pump();
    },
    /** The highest frame `seq` received; rides the next POST or goes alone. */
    ack(seq: number): void {
      if (seq > received) received = seq;
      pump();
    },
    /** Waits for the hand-off to be known (or the view to close) first. */
    finish(outcome: "done" | "cancel"): Promise<BrowserLiveFinishResult> {
      if (stopped) return Promise.resolve("abandoned");
      const done = finish.request(outcome);
      pump();
      return done;
    },
    /**
     * Stop sending. A pending `finish` settles with `result`: `answered` when
     * the hand-off is over anyway, `abandoned` when the view merely closed.
     */
    stop(result: BrowserLiveFinishResult): void {
      stopped = true;
      queue = [];
      batch = null;
      clearLane(events, clock);
      clearLane(acks, clock);
      finish.settle(result);
    },
  };
}

export type InputBatcher = ReturnType<typeof createInputBatcher>;
