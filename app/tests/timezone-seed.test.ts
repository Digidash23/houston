import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { detectTimezone, timezoneOwner } from "../src/lib/timezone-seed.ts";

describe("timezone seed scope", () => {
  it("is one person in one space, once both are known", () => {
    strictEqual(timezoneOwner("ana", true, "ws-1"), "ana:personal");
    strictEqual(
      timezoneOwner("ana", true, "org:0123456789abcdef"),
      "ana:0123456789abcdef",
    );
    strictEqual(timezoneOwner(null, true, "ws-1"), null);
    strictEqual(timezoneOwner("ana", true, null), null);
  });

  it("is the one local person when no identity is configured", () => {
    strictEqual(timezoneOwner(null, false, "ws-1"), "local:personal");
  });
});

describe("detected timezone", () => {
  it("is always an IANA-shaped answer", () => {
    strictEqual(detectTimezone().length > 0, true);
  });
});
