import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { firstNameOf } from "../src/lib/manager-onboarding/first-name.ts";

describe("firstNameOf", () => {
  it("greets by the first word of the display name", () => {
    strictEqual(firstNameOf("Ana María López"), "Ana");
    strictEqual(firstNameOf("  Julian  "), "Julian");
  });

  it("has no name to greet by without a real display name", () => {
    strictEqual(firstNameOf(null), null);
    strictEqual(firstNameOf(undefined), null);
    strictEqual(firstNameOf("   "), null);
    strictEqual(firstNameOf("ana@example.com"), null);
  });
});
