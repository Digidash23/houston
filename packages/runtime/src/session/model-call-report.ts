import {
  MODEL_CALL_REPORT_MAX_CALLS,
  type ModelCallBackend,
  type ModelCallReport,
  type ModelCallStartupStep,
  type ModelCallTiming,
} from "@houston/protocol";
import type { HarnessSession } from "../backends/types";

/**
 * What a standing engine measured before the turn's body ran (turn-start.ts):
 * how long building or loading the session took, and when the turn joined the
 * conversation queue and the workspace lock (`performance.now()`).
 */
export interface TurnStartupMarks {
  sessionBuildMs: number;
  queuedAt: number;
}

/** What a turn collects while its prompt runs, read once at the turn's end. */
export interface ModelCallCollector {
  /** Record a startup cost the turn measured itself (not the harness). */
  noteStartup(step: ModelCallStartupStep, ms: number): void;
  /** Detach from the session. Idempotent; the collected calls stay. */
  stop(): void;
  /** The turn's report, or undefined when the session reports no timings. */
  report(turnId: string): ModelCallReport | undefined;
}

/** The report's backend for a harness backend id: only pi runs in-process;
 *  the Claude backend registers under the provider id "anthropic". */
export function reportBackend(backendId: string): ModelCallBackend {
  return backendId === "pi" ? "pi" : "claude";
}

/**
 * Collect one turn's model-call report from `session` (protocol
 * model-call-report.ts). Only the latest harness_init counts: a Claude turn
 * that reruns fresh after a refused resume spawned twice, and the second
 * spawn is the one its calls ran on.
 */
export function collectModelCalls(
  session: HarnessSession,
  backendId: string,
): ModelCallCollector {
  const backend = reportBackend(backendId);
  const calls: ModelCallTiming[] = [];
  const startupMs: ModelCallReport["startupMs"] = {};
  let dropped = 0;
  let unsubscribe = session.subscribeModelCalls?.((event) => {
    if (event.type === "harness_init") startupMs.harness_init = event.ms;
    else if (calls.length < MODEL_CALL_REPORT_MAX_CALLS) calls.push(event.call);
    else dropped++;
  });
  const supported = unsubscribe !== undefined;
  return {
    noteStartup(step, ms) {
      startupMs[step] = Math.max(0, Math.round(ms));
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    report(turnId) {
      if (!supported) return undefined;
      return {
        v: 1,
        turnId,
        backend,
        startupMs: { ...startupMs },
        calls: [...calls],
        droppedCalls: dropped,
      };
    },
  };
}

/**
 * A standing engine's turn collector: the session's calls plus the startup
 * the turn measured before its body ran (`startup`) and from its body's
 * start (`enteredAt`) to the prompt, noted by `notePrompt`.
 */
export function collectStandingTurnCalls(
  session: HarnessSession,
  backendId: string,
  enteredAt: number,
  startup: TurnStartupMarks | undefined,
): ModelCallCollector & { notePrompt(): void } {
  const collector = collectModelCalls(session, backendId);
  if (startup) {
    collector.noteStartup("session_build", startup.sessionBuildMs);
    collector.noteStartup("queue_wait", enteredAt - startup.queuedAt);
  }
  return {
    ...collector,
    notePrompt: () =>
      collector.noteStartup("pre_prompt", performance.now() - enteredAt),
  };
}
