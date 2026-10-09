import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { describeError } from "../src/lib/describe-error.ts";

// HOUSTON-APP-53A: a typed shell rejection ({kind, message}) reached
// `String(err)` and every report read "save_download: [object Object]".
describe("describeError", () => {
  it("reads an Error's message and a string as itself", () => {
    strictEqual(describeError(new Error("boom")), "boom");
    strictEqual(describeError("raw text"), "raw text");
  });

  it("names a typed rejection as `kind: message`", () => {
    strictEqual(
      describeError({
        kind: "not_found",
        message: "Failed to save file: path not found (os error 3)",
      }),
      "not_found: Failed to save file: path not found (os error 3)",
    );
  });

  it("reads a message-only object as its message", () => {
    strictEqual(describeError({ message: "gone" }), "gone");
  });

  it("serializes an object without a message, never [object Object]", () => {
    strictEqual(describeError({ code: 7 }), '{"code":7}');
  });

  it("caps a long serialization", () => {
    const out = describeError({ blob: "x".repeat(5000) });
    strictEqual(out.length <= 501, true);
  });

  it("survives a circular object", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const out = describeError(loop);
    strictEqual(out.includes("[object Object]"), false);
    strictEqual(out.includes("a"), true);
  });

  it("stringifies primitives and nullish values", () => {
    strictEqual(describeError(undefined), "undefined");
    strictEqual(describeError(null), "null");
    strictEqual(describeError(42), "42");
  });
});
