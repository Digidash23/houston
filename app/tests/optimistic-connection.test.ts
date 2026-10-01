import { strictEqual } from "node:assert";
import { it } from "node:test";
import { optimisticConnectionState } from "../src/components/onboarding/connect-ai/optimistic-connection.ts";

it("offers Connect while the first probe is still on its way", () => {
  strictEqual(optimisticConnectionState("checking", false), "disconnected");
  strictEqual(optimisticConnectionState("connected", false), "connected");
});

it("shows the probe's own answer once it lands", () => {
  strictEqual(optimisticConnectionState("checking", true), "checking");
  strictEqual(optimisticConnectionState("disconnected", true), "disconnected");
});
