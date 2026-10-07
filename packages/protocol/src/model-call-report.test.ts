import { expect, test } from "vitest";
import {
  MODEL_CALL_REPORT_MAX_CALLS,
  parseModelCallReport,
} from "./model-call-report";

const call = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  ttfbMs: 1800,
  firstTokenMs: 600,
  inputTokens: 12,
  cacheReadTokens: 20_000,
  cacheWriteTokens: 300,
  outputTokens: 150,
};
const report = {
  v: 1,
  turnId: "turn-1",
  backend: "claude",
  startupMs: { harness_init: 800, pre_prompt: 40 },
  calls: [call],
  droppedCalls: 0,
};

test("a well-formed report round-trips unchanged", () => {
  expect(parseModelCallReport(JSON.parse(JSON.stringify(report)))).toEqual(
    report,
  );
});

test("a malformed top level means no report", () => {
  expect(parseModelCallReport(undefined)).toBeUndefined();
  expect(parseModelCallReport({ ...report, v: 2 })).toBeUndefined();
  expect(parseModelCallReport({ ...report, turnId: "" })).toBeUndefined();
  expect(parseModelCallReport({ ...report, backend: "x" })).toBeUndefined();
  expect(parseModelCallReport({ ...report, calls: "x" })).toBeUndefined();
});

test("a bad call or startup entry is dropped alone", () => {
  const parsed = parseModelCallReport({
    ...report,
    startupMs: { harness_init: -1, session_build: 5, other: 9 },
    calls: [call, { ...call, ttfbMs: Number.NaN }, { ...call, model: 3 }],
  });
  expect(parsed?.startupMs).toEqual({ session_build: 5 });
  expect(parsed?.calls).toEqual([call]);
});

test("firstTokenMs stays optional", () => {
  const { firstTokenMs: _, ...noToken } = call;
  expect(parseModelCallReport({ ...report, calls: [noToken] })?.calls).toEqual([
    noToken,
  ]);
});

test("calls past the cap are counted, not listed", () => {
  const parsed = parseModelCallReport({
    ...report,
    calls: Array.from({ length: MODEL_CALL_REPORT_MAX_CALLS + 3 }, () => call),
    droppedCalls: 2,
  });
  expect(parsed?.calls).toHaveLength(MODEL_CALL_REPORT_MAX_CALLS);
  expect(parsed?.droppedCalls).toBe(5);
});
