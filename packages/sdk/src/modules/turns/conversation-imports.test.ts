import type { ConversationImportRequest } from "@houston/protocol";
import { EngineError, type HoustonEngineClient } from "@houston/runtime-client";
import { describe, expect, test } from "vitest";
import { createAuthExpiryNotifier } from "../../auth-expiry";
import type { CommandHandler } from "../../commands";
import type { ModuleContext } from "../../module-context";
import type { SdkConfig } from "../../ports";
import { ScopeStore } from "../../store";
import { memoryKv } from "../../test-ports";
import { classifyImportFailure } from "./conversation-import-abort";
import { RESEND_AFTER_MS } from "./conversation-import-hold";
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

/** A page the test drives: leaving or not, and "live again" on demand. */
function fakePage(unloading = false) {
  const listeners = new Set<() => void>();
  return {
    unloading,
    lifecycle: {
      isUnloading: () => page.unloading,
      onLive: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    /** The page is live after all: the flag drops, listeners run. */
    live() {
      page.unloading = false;
      for (const listener of listeners) listener();
    },
  };
}
let page = fakePage();

/** Settled with its result, rejected, or still pending after a turn. */
async function stateOf<T>(p: Promise<T>): Promise<string> {
  const pending = Symbol("pending");
  const outcome = await Promise.race([
    p.then(
      (v) => ({ v }),
      (e: unknown) => ({ e }),
    ),
    new Promise<typeof pending>((r) => setTimeout(() => r(pending), 20)),
  ]);
  if (outcome === pending) return "pending";
  return "v" in outcome
    ? `resolved:${JSON.stringify(outcome.v)}`
    : `rejected:${String((outcome.e as Error).message)}`;
}

function harness(opts: { unloading: boolean } = { unloading: false }) {
  page = fakePage(opts.unloading);
  const stored = new Map<string, string>();
  const sent: Array<{ agentId: string; id: string; importId: string }> = [];
  /** What the runtime answers next: a count, an error to throw, or a
   *  promise of a count the test settles itself (a slow send). */
  const answers: Array<number | Error | Promise<number>> = [];
  /** The hold's own resend timers, fired by hand. */
  const timers: Array<{ id: number; fn: () => void; ms: number }> = [];
  let nextTimer = 1;
  const clock = {
    now: () => 0,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimer++;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id: number) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  };
  /** Let every armed resend timer lapse. */
  const elapse = () => {
    for (const t of timers.splice(0)) t.fn();
  };
  const commands = new Map<string, CommandHandler>();
  const store = new ScopeStore();
  const clientFor = (agentId: string) =>
    ({
      async importMessages(id: string, body: ConversationImportRequest) {
        sent.push({ agentId, id, importId: body.importId });
        const next = answers.shift() ?? body.messages.length;
        if (next instanceof Error) throw next;
        if (next instanceof Promise)
          return next.then((n) => ({ ok: true, imported: n }));
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
        pageLifecycle: page.lifecycle,
        clock,
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
  return { imports, sent, answers, stored, owed, commands, timers, elapse };
}

/** A promise the test settles by hand: a send that is still on the wire. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

  test("an import the page left mid-flight is held: pending, still owed, sent once more when the page is live", async () => {
    // A reload aborts the fetch; the browser reports it like a dead network.
    const h = harness({ unloading: true });
    h.answers.push(new TypeError("Failed to fetch"));
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    expect(h.owed()).toEqual([
      { agentId: "ws/.assistant", conversationId: "assistant", request },
    ]);
    expect(h.sent).toHaveLength(1);

    // The navigation was cancelled (or the document came back from the
    // back/forward cache): the import goes out again and the hold settles.
    page.live();
    expect(await stateOf(held)).toBe('resolved:{"ok":true,"imported":2}');
    expect(h.sent).toHaveLength(2);
    expect(h.stored.has(PENDING_IMPORTS_KEY)).toBe(false);
  });

  test("a held import whose resend the host refuses settles with that refusal", async () => {
    const h = harness({ unloading: true });
    const busy = new EngineError(409, '{"error":"turn running"}');
    h.answers.push(new TypeError("Failed to fetch"), busy);
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    page.live();
    expect(await stateOf(held)).toBe(`rejected:${busy.message}`);
    expect(h.owed()).toHaveLength(1);
  });

  test("a page that really left never settles the hold; the import stays owed for the next load", async () => {
    const h = harness({ unloading: true });
    h.answers.push(new TypeError("Failed to fetch"));
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    expect(h.owed()).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  test("a resend that gets no answer stays held and settles on the next live", async () => {
    const h = harness({ unloading: true });
    h.answers.push(
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
    );
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    // The 2 s fallback fired on a page still leaving: the resend dies too.
    page.live();
    expect(await stateOf(held)).toBe("pending");
    expect(h.sent).toHaveLength(2);
    expect(h.owed()).toHaveLength(1);
    page.live();
    expect(await stateOf(held)).toBe('resolved:{"ok":true,"imported":2}');
    expect(h.sent).toHaveLength(3);
  });

  test("a pagehide followed by nothing: the hold's own timer still resends", async () => {
    // iOS backgrounds the tab (pagehide) and brings it back with no pageshow:
    // the port's flag stays up, but a timer that fires is a page that is alive.
    const h = harness({ unloading: true });
    h.answers.push(new TypeError("Failed to fetch"));
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    expect(h.timers.map((t) => t.ms)).toEqual([RESEND_AFTER_MS]);
    h.elapse();
    expect(await stateOf(held)).toBe('resolved:{"ok":true,"imported":2}');
    expect(h.sent).toHaveLength(2);
    expect(h.timers).toHaveLength(0);
  });

  test("two lives during one slow resend send once", async () => {
    const h = harness({ unloading: true });
    const slow = deferred<number>();
    h.answers.push(new TypeError("Failed to fetch"), slow.promise);
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    page.live();
    page.live();
    h.elapse();
    expect(h.sent).toHaveLength(2);
    slow.resolve(2);
    expect(await stateOf(held)).toBe('resolved:{"ok":true,"imported":2}');
    expect(h.sent).toHaveLength(2);
  });

  test("asking again for a held import joins the hold instead of sending twice", async () => {
    const h = harness({ unloading: true });
    h.answers.push(new TypeError("Failed to fetch"));
    const first = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(first)).toBe("pending");
    const second = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(second)).toBe("pending");
    page.live();
    expect(await stateOf(first)).toBe('resolved:{"ok":true,"imported":2}');
    expect(await stateOf(second)).toBe('resolved:{"ok":true,"imported":2}');
    // One send before the hold, one resend after it: the second ask sent nothing.
    expect(h.sent).toHaveLength(2);
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
  test("blocks on a held entry and resolves with it once the page is live", async () => {
    const h = harness({ unloading: true });
    h.answers.push(new TypeError("Failed to fetch"));
    const held = h.imports.importMessages(
      "assistant",
      "ws/.assistant",
      request,
    );
    expect(await stateOf(held)).toBe("pending");
    const retry = h.imports.retryPendingImports("ws/.assistant");
    expect(await stateOf(retry)).toBe("pending");
    page.live();
    await expect(retry).resolves.toEqual({
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
    expect(h.sent).toHaveLength(2);
  });

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
    expect(classifyImportFailure(new TypeError("Failed to fetch"), true)).toBe(
      "aborted",
    );
    expect(classifyImportFailure(new TypeError("Failed to fetch"), false)).toBe(
      "failed",
    );
    expect(classifyImportFailure(new EngineError(503, "waking"), true)).toBe(
      "failed",
    );
    expect(classifyImportFailure("not even an error", true)).toBe("aborted");
  });
});
