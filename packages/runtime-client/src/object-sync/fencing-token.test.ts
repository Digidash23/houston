import { expect, test } from "vitest";
import { captureFencingToken } from "./fencing-token";

test("takes a published token when the boot has none", () => {
  const fence: { token?: string } = {};
  captureFencingToken(fence, "7");
  expect(fence.token).toBe("7");
});

test("moves only forward: a replica's cached older token never replaces the boot's own", () => {
  // This boot minted 12; a replica whose ≤2s lease cache still holds the
  // predecessor's 11 serves the next hydrate read.
  const fence: { token?: string } = { token: "12" };
  captureFencingToken(fence, "11");
  expect(fence.token).toBe("12");
  captureFencingToken(fence, "12");
  expect(fence.token).toBe("12");
  // A newer mint (another boot's) is still picked up; the write then meets
  // the holder check and the boot learns it was superseded.
  captureFencingToken(fence, "13");
  expect(fence.token).toBe("13");
});

test("ignores an absent or malformed header", () => {
  const fence: { token?: string } = { token: "3" };
  captureFencingToken(fence, null);
  captureFencingToken(fence, "");
  captureFencingToken(fence, "not-a-number");
  expect(fence.token).toBe("3");
});
