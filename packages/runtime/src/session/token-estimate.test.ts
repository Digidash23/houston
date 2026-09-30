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
