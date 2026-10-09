import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  BridgeDisposedError,
  BridgeStateError,
} from "@houston/sdk/local-model-bridge/errors";
import { planLocalBridgeReport } from "../src/lib/local-bridge-report-plan.ts";

// HOUSTON-APP-5HX: a space or agent switch aborted the wake's status GET and
// the funnel reported the AbortError as "Local model connection failed". A
// cancellation is superseded work, not a failure: it is dropped before any
// report, while the known quiet class and every real failure keep their path.
describe("planLocalBridgeReport", () => {
  it("drops an aborted operation, keeping only its cause for the debug log", () => {
    deepStrictEqual(
      planLocalBridgeReport(
        new DOMException("The operation was aborted.", "AbortError"),
      ),
      { kind: "cancelled", cause: "AbortError: The operation was aborted." },
    );
  });

  it("drops an operation that reached a disposed controller", () => {
    strictEqual(
      planLocalBridgeReport(new BridgeDisposedError()).kind,
      "cancelled",
    );
  });

  it("keeps the unsupported deployment as its quiet class", () => {
    deepStrictEqual(
      planLocalBridgeReport(
        Object.assign(new Error("unsupported"), {
          status: 503,
          body: { code: "bridge_not_supported" },
        }),
      ),
      { kind: "unsupported" },
    );
  });

  it("keeps every other rejection loud, with its name and message as the cause", () => {
    deepStrictEqual(
      planLocalBridgeReport(new BridgeStateError("reconnecting")),
      { kind: "failed", cause: "BridgeStateError: reconnecting" },
    );
    deepStrictEqual(
      planLocalBridgeReport(
        Object.assign(new TypeError("Load failed"), { status: 0 }),
      ),
      { kind: "failed", cause: "TypeError: Load failed" },
    );
    deepStrictEqual(planLocalBridgeReport("boom"), {
      kind: "failed",
      cause: "boom",
    });
  });
});
