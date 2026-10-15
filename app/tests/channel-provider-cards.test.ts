import { deepStrictEqual } from "node:assert";
import { test } from "node:test";
import {
  channelCardState,
  channelProviderCards,
} from "../src/components/settings/sections/channel-provider-cards.ts";

test("known provider cards render in stable order with their own accounts and readiness", () => {
  const status = {
    providers: [
      { id: "whatsapp" as const, name: "WhatsApp", configured: false },
      { id: "slack" as const, name: "Slack", configured: true },
    ],
    connections: [
      {
        id: "w",
        provider: "whatsapp" as const,
        accountLabel: "•••• 1111",
        spaceId: "personal",
        createdAt: "2026-09-24T12:00:00Z",
      },
      {
        id: "s",
        provider: "slack" as const,
        accountLabel: "Ada",
        spaceId: "personal",
        createdAt: "2026-09-24T12:00:00Z",
      },
    ],
  };
  const cards = channelProviderCards(status);
  deepStrictEqual(
    cards.map(({ provider }) => [provider.id, provider.configured]),
    [
      ["slack", true],
      ["whatsapp", false],
    ],
  );
  deepStrictEqual(
    cards.map(({ connections }) => connections.map(({ id }) => id)),
    [["s"], ["w"]],
  );
});

test("a provider that is not set up shows no card until it is, unless the person holds a connection there", () => {
  const providers = [
    { id: "slack" as const, name: "Slack", configured: true },
    { id: "whatsapp" as const, name: "WhatsApp", configured: false },
  ];
  deepStrictEqual(
    channelProviderCards({ providers, connections: [] }).map(
      ({ provider }) => provider.id,
    ),
    ["slack"],
  );
  deepStrictEqual(
    channelProviderCards({
      providers: providers.map((item) => ({ ...item, configured: true })),
      connections: [],
    }).map(({ provider }) => provider.id),
    ["slack", "whatsapp"],
  );
});

test("a card is unavailable, empty, or connected, and unavailable keeps its accounts", () => {
  const ada = {
    id: "s",
    provider: "slack" as const,
    accountLabel: "Ada",
    spaceId: "personal",
    createdAt: "2026-09-24T12:00:00Z",
  };
  deepStrictEqual(channelCardState(true, []), { kind: "empty" });
  deepStrictEqual(channelCardState(true, [ada]), {
    kind: "connected",
    connections: [ada],
  });
  deepStrictEqual(channelCardState(false, [ada]), {
    kind: "unavailable",
    connections: [ada],
  });
  deepStrictEqual(channelCardState(false, []), {
    kind: "unavailable",
    connections: [],
  });
});
