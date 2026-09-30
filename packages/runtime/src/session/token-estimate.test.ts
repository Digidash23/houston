import { expect, test } from "vitest";
import { estimateTokens } from "./token-estimate";

test("English prose costs about a token per four characters", () => {
  const prose = "the quick brown fox jumps over the lazy dog ".repeat(100);
  expect(estimateTokens(prose)).toBe(Math.ceil(prose.length / 4));
});

test("digits, punctuation and identifiers cost a token per two characters", () => {
  const log = '2026-09-30T10:31:57Z [42] {"id":"a1b2"} 0x7f3e;'.repeat(50);
  expect(estimateTokens(log)).toBeGreaterThanOrEqual(log.length / 3);
});

test("CJK and other non-Latin text costs a token per character", () => {
  const cjk = "請求書の確認が完了しました。未払いは三件です。".repeat(40);
  expect(estimateTokens(cjk)).toBe(cjk.length);
});

test("base64, hex and opaque ids cost at least a token per two characters", () => {
  const base64 = Buffer.from(
    Array.from({ length: 3_000 }, (_, i) => (i * 7919) % 256),
  ).toString("base64");
  expect(estimateTokens(base64)).toBeGreaterThanOrEqual(base64.length / 2);
  const hex =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ".repeat(
      40,
    );
  expect(estimateTokens(hex)).toBeGreaterThanOrEqual(hex.length / 2);
  const ids = "usr_9fK2mQ7xL0pZ3vB8 ord_Q1w2E3r4T5y6U7i8 ".repeat(60);
  expect(estimateTokens(ids)).toBeGreaterThanOrEqual(ids.length / 2);
});

test("ordinary long words are still prose", () => {
  const words =
    "internationalization responsibilities misunderstanding ".repeat(50);
  expect(estimateTokens(words)).toBe(Math.ceil(words.length / 4));
});
