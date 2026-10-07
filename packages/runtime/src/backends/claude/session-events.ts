import type { WireEvent } from "@houston/runtime-client";
import type { HarnessTimingEvent } from "../types";

/**
 * A session's three independent subscriber fan-outs: the translated wire events
 * a turn produces, the raw liveness tick, and the assistant message-start
 * boundary. Kept apart because they carry different traffic — see
 * `subscribeLiveness` and `subscribeAssistantMessageStart`.
 */
export class SessionEventHub {
  private readonly listeners = new Set<(e: WireEvent) => void>();
  private readonly livenessListeners = new Set<() => void>();
  private readonly messageStartListeners = new Set<() => void>();
  private readonly timingListeners = new Set<(e: HarnessTimingEvent) => void>();

  subscribe(listener: (e: WireEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Every SDK message the query yields, before translation. `translate` drops
   * `input_json_delta` (a tool call's streamed input) until the block closes,
   * so a long file write is wire-silent; the liveness channel still ticks.
   */
  subscribeLiveness(listener: () => void): () => void {
    this.livenessListeners.add(listener);
    return () => {
      this.livenessListeners.delete(listener);
    };
  }

  /**
   * The Messages API `message_start` stream event of the main thread: one
   * model round-trip beginning (a subagent's stream carries a parent tool id
   * and is not this conversation's message).
   */
  subscribeAssistantMessageStart(listener: () => void): () => void {
    this.messageStartListeners.add(listener);
    return () => {
      this.messageStartListeners.delete(listener);
    };
  }

  /** Per-call timings and the CLI's spawn-to-init cost (model-calls.ts). */
  subscribeModelCalls(listener: (e: HarnessTimingEvent) => void): () => void {
    this.timingListeners.add(listener);
    return () => {
      this.timingListeners.delete(listener);
    };
  }

  emitTiming(e: HarnessTimingEvent): void {
    for (const l of this.timingListeners) l(e);
  }

  emit(e: WireEvent): void {
    for (const l of this.listeners) l(e);
  }

  tickLiveness(): void {
    for (const l of this.livenessListeners) l();
  }

  emitAssistantMessageStart(): void {
    for (const l of this.messageStartListeners) l();
  }

  clearListeners(): void {
    this.listeners.clear();
    this.livenessListeners.clear();
    this.messageStartListeners.clear();
    this.timingListeners.clear();
  }
}

/**
 * The `HarnessSession` subscription surface over a session's own hub: the
 * session emits into `events`, its subscribers attach here.
 */
export abstract class SessionEventSubscriptions {
  protected readonly events = new SessionEventHub();

  subscribe(listener: (e: WireEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  subscribeLiveness(listener: () => void): () => void {
    return this.events.subscribeLiveness(listener);
  }

  /**
   * The Messages API `message_start` stream event of the main thread: one
   * model round-trip beginning (a subagent's stream carries a parent tool id
   * and is not this conversation's message).
   */
  subscribeAssistantMessageStart(listener: () => void): () => void {
    return this.events.subscribeAssistantMessageStart(listener);
  }

  subscribeModelCalls(listener: (e: HarnessTimingEvent) => void): () => void {
    return this.events.subscribeModelCalls(listener);
  }
}
