import { ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { markToldUser, wasToldUser } from "../src/lib/user-told-mark.ts";

describe("user-told mark", () => {
  it("marks an error object and reads it back", () => {
    const err = new Error("last owner");
    strictEqual(wasToldUser(err), false);
    markToldUser(err);
    strictEqual(wasToldUser(err), true);
  });

  it("ignores values that cannot carry it", () => {
    markToldUser("boom");
    markToldUser(null);
    const frozen = Object.freeze(new Error("x"));
    markToldUser(frozen);
    strictEqual(wasToldUser("boom"), false);
    strictEqual(wasToldUser(null), false);
    strictEqual(wasToldUser(frozen), false);
  });

  it("call() stamps it only when its ladder told the user", () => {
    // Source text: tauri.ts pulls the engine and the i18n barrel, which this
    // runner cannot load.
    const src = readFileSync(
      join(import.meta.dirname, "../src/lib/tauri.ts"),
      "utf8",
    );
    ok(
      src.includes(
        "if (await surfaceError(label, err, context, options)) markToldUser(err);",
      ),
    );
    const ladder = src.slice(
      src.indexOf("async function surfaceError("),
      src.indexOf("// ─── Workspaces"),
    );
    ok(ladder.includes("if (options?.silence?.(err)) return false;"));
    ok(
      ladder.includes(
        "showConnectivityErrorToast(label, message, err);\n    return true;",
      ),
    );
    ok(ladder.trimEnd().endsWith("return false;\n}"));
  });
});
