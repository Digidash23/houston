import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanMissionTitle,
  generateMissionTitle,
  parseMissionTitle,
} from "./mission-title";

const REQ = {
  fallback: "Write the weekly...",
  text: "Write the weekly sales report",
};

afterEach(() => vi.restoreAllMocks());

describe("parseMissionTitle", () => {
  test("keeps a well-formed request and drops anything malformed", () => {
    expect(parseMissionTitle(REQ)).toEqual(REQ);
    expect(parseMissionTitle(undefined)).toBeUndefined();
    expect(parseMissionTitle({ fallback: "x" })).toBeUndefined();
    expect(parseMissionTitle({ fallback: " ", text: "t" })).toBeUndefined();
  });
});

describe("cleanMissionTitle", () => {
  test("first line, no quotes, at most six words", () => {
    expect(cleanMissionTitle('"Weekly sales report."\nextra')).toBe(
      "Weekly sales report",
    );
    expect(cleanMissionTitle("one two three four five six seven")).toBe(
      "one two three four five six",
    );
    expect(cleanMissionTitle("  ")).toBeNull();
  });
});

describe("generateMissionTitle", () => {
  test("returns the cleaned title from the runner", async () => {
    const run = vi.fn(async () => "Weekly sales summary");
    await expect(generateMissionTitle("c1", REQ, run)).resolves.toBe(
      "Weekly sales summary",
    );
    expect(run).toHaveBeenCalledWith(REQ.text, expect.any(AbortSignal));
  });

  test("a title equal to the fallback writes nothing", async () => {
    const req = { fallback: "Weekly report", text: "weekly report" };
    const run = async () => "Weekly report";
    await expect(generateMissionTitle("c1", req, run)).resolves.toBeNull();
  });

  test("a failing runner keeps the fallback and reports, never throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = async (): Promise<string> => {
      throw new Error("quota");
    };
    await expect(generateMissionTitle("c1", REQ, run)).resolves.toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });

  test("a runner past the cap keeps the fallback and is aborted", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const run = (_excerpt: string, s: AbortSignal) => {
      signal = s;
      return new Promise<string>(() => {});
    };
    const pending = generateMissionTitle("c1", REQ, run, 10_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    // The cap aborts the model call instead of letting it run on.
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
