import type { ConversationImportRequest } from "@houston/protocol";
import { EngineError, type HoustonEngineClient } from "@houston/runtime-client";
import { describe, expect, test } from "vitest";
import { createAuthExpiryNotifier } from "../../auth-expiry";
import type { CommandHandler } from "../../commands";
import type { ModuleContext } from "../../module-context";
import type { SdkConfig } from "../../ports";
import { ScopeStore } from "../../store";
import { memoryKv } from "../../test-ports";
import {
  ConversationImportAbortedError,
  classifyImportFailure,
} from "./conversation-import-abort";
import { PENDING_IMPORTS_KEY } from "./conversation-import-outbox";
import { createConversationImports } from "./conversation-imports";

/**
 * Imports are an outbox: written down before they are sent, crossed off once
 * the runtime answers or refuses for good, and sent again by
 * `retryPendingImports` when the send failed on the way.
 */

const request: ConversationImportRequest = {
  importId: "onboarding:first_run",
  messages: [
    { role: "assistant", content: "Hi Ana!" },
    { role: "user", content: "Retail and e-commerce" },
  ],
};

function harness(page: { unloading: boolean } = { unloading: false }) {
  const stored = new Map<string, string>();
  const sent: Array<{ agentId: string; id: string; importId: string }> = [];
  /** What the runtime answers next: a count, or an error to throw. */
  const answers: Array<number | Error> = [];
  const commands = new Map<string, CommandHandler>();
  const store = new ScopeStore();
  const clientFor = (agentId: string) =>
    ({
      async importMessages(id: string, body: ConversationImportRequest) {
        sent.push({ agentId, id, importId: body.importId });
        const next = answers.shift() ?? body.messages.length;
        if (next instanceof Error) throw next;
        return { ok: true, imported: next };
      },
    }) as unknown as HoustonEngineClient;
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const ctx: ModuleContext = {
    config: {
      baseUrl: "http://x",
      ports: {
        logger,
        storage: memoryKv(stored),
        pageLifecycle: { isUnloading: () => page.unloading },
      } as unknown as SdkConfig["ports"],
      reactivity: false,
    },
    store,
    clientFor,
    authExpiry: createAuthExpiryNotifier(store),
    registerCommand: (type, handler) => void commands.set(type, handler),
  };
  const imports = createConversationImports(ctx);
  const owed = () => JSON.parse(stored.get(PENDING_IMPORTS_KEY) ?? "[]");
  return { imports, sent, answers, stored, owed, commands };
}

describe("importMessages", () => {
  test("sends the import and owes nothing once it lands", async () => {
    const h = harness();
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).resolves.toEqual({ ok: true, imported: 2 });
    expect(h.sent).toEqual([
      {
        agentId: "ws/.assistant",
        id: "assistant",
        importId: "onboarding:first_run",
      },
    ]);
    expect(h.stored.has(PENDING_IMPORTS_KEY)).toBe(false);
  });

  test("keeps an import the runtime could not take yet, and rethrows", async () => {
    const h = harness();
    const busy = new EngineError(409, '{"error":"turn running"}');
    h.answers.push(busy);
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toBe(busy);
    expect(h.owed()).toEqual([
      { agentId: "ws/.assistant", conversationId: "assistant", request },
    ]);
  });

  test("drops an import the runtime refuses for good", async () => {
    const h = harness();
    h.answers.push(new EngineError(404, '{"error":"agent not found"}'));
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toBeInstanceOf(EngineError);
    expect(h.stored.has(PENDING_IMPORTS_KEY)).toBe(false);
  });

  test("an import the page left mid-flight is aborted, not failed, and stays owed", async () => {
    // A reload aborts the fetch; the browser reports it like a dead network.
    const h = harness({ unloading: true });
    const dropped = new TypeError("Failed to fetch");
    h.answers.push(dropped);
    const rejection = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    await expect(rejection).rejects.toBeInstanceOf(
      ConversationImportAbortedError,
    );
    await expect(rejection).rejects.toMatchObject({
      name: "AbortError",
      reason: "unload",
      cause: dropped,
    });
    expect(h.owed()).toEqual([
      { agentId: "ws/.assistant", conversationId: "assistant", request },
    ]);
  });

  test("a host answer during unload is still that answer", async () => {
    const h = harness({ unloading: true });
    const refused = new EngineError(500, '{"error":"disk full"}');
    h.answers.push(refused);
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toBe(refused);
    expect(h.owed()).toHaveLength(1);
  });

  test("the same transport drop on a live page is a failure", async () => {
    const h = harness();
    const dropped = new TypeError("Failed to fetch");
    h.answers.push(dropped);
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toBe(dropped);
    expect(h.owed()).toHaveLength(1);
  });

  test("owes one entry per import however often it is asked", async () => {
    const h = harness();
    h.answers.push(new Error("offline"), new Error("offline"));
    for (let i = 0; i < 2; i += 1)
      await expect(
        h.imports.importMessages("assistant", "ws/.assistant", request),
      ).rejects.toThrow("offline");
    expect(h.owed()).toHaveLength(1);
  });
});

describe("retryPendingImports", () => {
  test("sends every owed import again and crosses off the ones that land", async () => {
    const h = harness();
    h.answers.push(new Error("offline"));
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toThrow("offline");

    await expect(
      h.imports.retryPendingImports("ws/.assistant"),
    ).resolves.toEqual({
      landed: [
        {
          agentId: "ws/.assistant",
          conversationId: "assistant",
          importId: "onboarding:first_run",
          imported: 2,
        },
      ],
      failures: [],
    });
    expect(h.stored.has(PENDING_IMPORTS_KEY)).toBe(false);
  });

  test("reports what still fails and keeps owing it", async () => {
    const h = harness();
    const offline = new Error("offline");
    h.answers.push(offline, offline);
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toBe(offline);

    await expect(
      h.imports.retryPendingImports("ws/.assistant"),
    ).resolves.toEqual({
      landed: [],
      failures: [
        {
          agentId: "ws/.assistant",
          conversationId: "assistant",
          importId: "onboarding:first_run",
          error: offline,
        },
      ],
    });
    expect(h.owed()).toHaveLength(1);
  });

  test("sends only the asked agent's owed imports, keeping another person's", async () => {
    // A device someone else signs in to holds their owed import too: their
    // agent would refuse it, and that refusal would cross it off for good.
    const h = harness();
    h.answers.push(new Error("offline"), new Error("offline"));
    await expect(
      h.imports.importMessages("assistant", "ws/.assistant", request),
    ).rejects.toThrow("offline");
    await expect(
      h.imports.importMessages("assistant", "other/.assistant", request),
    ).rejects.toThrow("offline");
    h.sent.length = 0;

    const outcome = await h.imports.retryPendingImports("ws/.assistant");
    expect(outcome.landed.map((l) => l.agentId)).toEqual(["ws/.assistant"]);
    expect(h.sent).toHaveLength(1);
    expect(h.owed().map((e: { agentId: string }) => e.agentId)).toEqual([
      "other/.assistant",
    ]);
  });

  test("owes nothing when the stored list is not one it wrote", async () => {
    const h = harness();
    h.stored.set(PENDING_IMPORTS_KEY, "{not json");
    await expect(
      h.imports.retryPendingImports("ws/.assistant"),
    ).resolves.toEqual({
      landed: [],
      failures: [],
    });
    expect(h.sent).toEqual([]);
  });
});

test("the commands validate their payload before anything is sent", async () => {
  const h = harness();
  const run = h.commands.get("turns/importMessages");
  expect(() =>
    run?.({ conversationId: "assistant", agentId: "a", request: {} }),
  ).toThrow("turns/importMessages requires an import request");
  await run?.({ conversationId: "assistant", agentId: "a", request });
  expect(h.sent).toHaveLength(1);
  expect(() => h.commands.get("turns/retryPendingImports")?.({})).toThrow(
    "turns/retryPendingImports requires a string agentId",
  );
});

describe("classifyImportFailure", () => {
  test("reads the page and the error", () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    expect(classifyImportFailure(new TypeError("Failed to fetch"), true)).toBe(
      "aborted",
    );
    expect(classifyImportFailure(new TypeError("Failed to fetch"), false)).toBe(
      "failed",
    );
    expect(classifyImportFailure(abort, false)).toBe("aborted");
    expect(classifyImportFailure(new EngineError(503, "waking"), true)).toBe(
      "failed",
    );
    expect(classifyImportFailure("not even an error", true)).toBe("aborted");
  });
});
