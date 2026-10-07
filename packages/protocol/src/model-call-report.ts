/**
 * Per-turn model call timings, reported to the cloud gateway so per-call
 * latency is visible in its metrics on every execution path. A pooled worker
 * carries the report on its terminal frame (`data.modelCalls`); a standing
 * engine's runtime hands it to its host on the turn-end settle, and the host
 * forwards it. Never shown to a user, never read by a client.
 */

/** One model request: request out, response opened, first answer token. */
export interface ModelCallTiming {
  /** The provider id the call went to. A bare string on purpose: custom and
   *  OpenAI-compatible endpoints pass their own ids through, and the gateway
   *  bounds the label itself. */
  provider: string;
  model: string;
  /** Request sent to the response opening (headers or `message_start`). */
  ttfbMs: number;
  /**
   * Response opened to the first text or tool-call token. Absent when the call
   * produced neither (a reply that only thought, or an empty one). Thinking
   * time before the first answer token is inside this span.
   */
  firstTokenMs?: number;
  /** Input tokens billed without a cache hit. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/**
 * The per-turn startup costs a report may carry. `harness_init`: the Claude
 * CLI spawn until its init message (absent on in-process providers).
 * `session_build`: a standing engine building or loading the conversation's
 * session. `queue_wait`: a standing engine's turn waiting for the
 * conversation queue and the workspace lock (another turn running).
 * `pre_prompt`: the turn's own setup until the prompt reaches the harness;
 * on a pooled worker it runs from the request's arrival, so it includes
 * hydration.
 */
export const MODEL_CALL_STARTUP_STEPS = [
  "harness_init",
  "session_build",
  "queue_wait",
  "pre_prompt",
] as const;
export type ModelCallStartupStep = (typeof MODEL_CALL_STARTUP_STEPS)[number];

export type ModelCallBackend = "claude" | "pi";

/** Calls past this many are counted in `droppedCalls`, never listed. */
export const MODEL_CALL_REPORT_MAX_CALLS = 64;

export interface ModelCallReport {
  v: 1;
  turnId: string;
  backend: ModelCallBackend;
  startupMs: Partial<Record<ModelCallStartupStep, number>>;
  calls: ModelCallTiming[];
  droppedCalls: number;
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseCall(value: unknown): ModelCallTiming | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  const numbers = [
    c.ttfbMs,
    c.inputTokens,
    c.cacheReadTokens,
    c.cacheWriteTokens,
    c.outputTokens,
  ];
  if (typeof c.provider !== "string" || typeof c.model !== "string")
    return undefined;
  if (!numbers.every(finiteNonNegative)) return undefined;
  if (c.firstTokenMs !== undefined && !finiteNonNegative(c.firstTokenMs))
    return undefined;
  return {
    provider: c.provider,
    model: c.model,
    ttfbMs: c.ttfbMs as number,
    ...(c.firstTokenMs !== undefined
      ? { firstTokenMs: c.firstTokenMs as number }
      : {}),
    inputTokens: c.inputTokens as number,
    cacheReadTokens: c.cacheReadTokens as number,
    cacheWriteTokens: c.cacheWriteTokens as number,
    outputTokens: c.outputTokens as number,
  };
}

/**
 * Normalize an untrusted report. Anything malformed at the top level means "no
 * report"; a malformed call or startup entry is dropped alone, so one bad
 * number never costs the turn's other measurements.
 */
export function parseModelCallReport(
  value: unknown,
): ModelCallReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (r.v !== 1 || typeof r.turnId !== "string" || !r.turnId) return undefined;
  if (r.backend !== "claude" && r.backend !== "pi") return undefined;
  if (!Array.isArray(r.calls)) return undefined;
  const startupIn =
    r.startupMs && typeof r.startupMs === "object"
      ? (r.startupMs as Record<string, unknown>)
      : {};
  const startupMs: ModelCallReport["startupMs"] = {};
  for (const step of MODEL_CALL_STARTUP_STEPS)
    if (finiteNonNegative(startupIn[step])) startupMs[step] = startupIn[step];
  const calls = r.calls
    .slice(0, MODEL_CALL_REPORT_MAX_CALLS)
    .map(parseCall)
    .filter((c): c is ModelCallTiming => c !== undefined);
  const dropped = finiteNonNegative(r.droppedCalls) ? r.droppedCalls : 0;
  return {
    v: 1,
    turnId: r.turnId,
    backend: r.backend,
    startupMs,
    calls,
    droppedCalls:
      dropped + Math.max(0, r.calls.length - MODEL_CALL_REPORT_MAX_CALLS),
  };
}
