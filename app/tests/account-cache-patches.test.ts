import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { ApiKey, ChannelStatus } from "@houston/wire-types";
import {
  apiKeysWithout,
  channelsWithout,
} from "../src/lib/account-cache-patches.ts";

const key = (id: string): ApiKey => ({
  id,
  name: id,
  prefix: "hst_",
  createdAt: "2026-10-01T00:00:00Z",
});

describe("account cache patches", () => {
  it("drops a revoked API key, idempotently", () => {
    const keys = [key("k1"), key("k2")];
    const next = apiKeysWithout(keys, "k1");
    deepStrictEqual(
      next?.map((k) => k.id),
      ["k2"],
    );
    strictEqual(apiKeysWithout(next, "k1"), next);
    strictEqual(apiKeysWithout(undefined, "k1"), undefined);
  });

  it("drops a disconnected channel and keeps the providers", () => {
    const status: ChannelStatus = {
      providers: [{ id: "slack", name: "Slack", configured: true }],
      connections: [
        {
          id: "c1",
          provider: "slack",
          accountLabel: "Acme",
          spaceId: "s1",
          createdAt: "2026-10-01T00:00:00Z",
        },
      ],
    };
    const next = channelsWithout(status, "c1");
    deepStrictEqual(next?.connections, []);
    strictEqual(next?.providers, status.providers);
    strictEqual(channelsWithout(next, "c1"), next);
    strictEqual(channelsWithout(undefined, "c1"), undefined);
  });
});
