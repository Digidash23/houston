import { describe, expect, test } from "vitest";
import {
  AUTO_CONTINUE_MARKER,
  encodeAutoContinue,
  encodeHeartbeat,
  HEARTBEAT_MARKER,
  isAutoContinue,
  isHeartbeat,
} from "./auto-continue";

describe("the heartbeat marker", () => {
  test("is the exact byte layout the cloud gateway also sends", () => {
    expect(encodeHeartbeat("Brief them.")).toBe(
      "<!--houston:auto_continue-->\n\n<!--houston:heartbeat-->\nBrief them.",
    );
    expect(encodeHeartbeat("x")).toBe(
      `${AUTO_CONTINUE_MARKER}\n\n${HEARTBEAT_MARKER}\nx`,
    );
  });

  test("is still an auto-continue message, so every transcript hides it", () => {
    expect(isAutoContinue(encodeHeartbeat("Brief them."))).toBe(true);
  });

  test("tells a briefing apart from any other hidden message", () => {
    expect(isHeartbeat(encodeHeartbeat("Brief them."))).toBe(true);
    expect(isHeartbeat(encodeAutoContinue("continue"))).toBe(false);
    expect(isHeartbeat(`${HEARTBEAT_MARKER}\nBrief them.`)).toBe(false);
    expect(isHeartbeat("Brief them.")).toBe(false);
  });
});
