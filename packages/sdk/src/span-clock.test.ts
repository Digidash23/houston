import { describe, expect, it } from "vitest";
import { createSpanClock } from "./span-clock";

function clocks() {
  let wall = 1_000_000;
  let monotonic = 50;
  const read = createSpanClock(
    () => wall,
    () => monotonic,
  );
  return {
    read,
    tick: (wallMs: number, monotonicMs: number) => {
      wall += wallMs;
      monotonic += monotonicMs;
    },
  };
}

describe("the span clock", () => {
  it("counts time as both clocks agree on it", () => {
    const { read, tick } = clocks();
    const start = read();
    tick(1_500, 1_500);
    expect(read() - start).toBe(1_500);
  });

  it("counts a system sleep the monotonic clock missed", () => {
    const { read, tick } = clocks();
    const start = read();
    tick(10_000, 10_000);
    tick(60_000, 0);
    expect(read() - start).toBe(70_000);
  });

  it("never goes back with a wall clock set back", () => {
    const { read, tick } = clocks();
    const start = read();
    tick(-15_000, 0);
    const after = read();
    expect(after).toBe(start);
    tick(30_000, 30_000);
    expect(read() - start).toBe(30_000);
  });
});
