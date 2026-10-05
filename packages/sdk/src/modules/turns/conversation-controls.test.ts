import { expect, test, vi } from "vitest";
import type { ModuleContext } from "../../module-context";
import { createConversationControls } from "./conversation-controls";
import { StreamRegistry, streamKey } from "./stream-registry";

function controls(cancelled: boolean) {
  const cancel = vi.fn(async () => ({ ok: true, cancelled }));
  const ctx = {
    clientFor: () => ({ cancel }),
    registerCommand: () => {},
    config: {
      baseUrl: "http://host",
      ports: {
        clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
    },
  } as unknown as ModuleContext;
  const registry = new StreamRegistry();
  return {
    cancel,
    registry,
    controls: createConversationControls(ctx, registry),
  };
}

test("Stop ends a message still waiting to go out, and still asks the engine", async () => {
  const { cancel, registry, controls: c } = controls(false);
  const stopUnsent = vi.fn(() => true);
  registry.set(streamKey("a1", "c1"), {
    kind: "turn",
    dispose: () => {},
    stopUnsent,
  });

  expect(await c.cancel("c1", "a1")).toEqual({ ok: true, cancelled: true });
  expect(stopUnsent).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledWith("c1");
});

test("with nothing waiting, Stop is the engine's answer alone", async () => {
  const { registry, controls: c } = controls(false);
  registry.set(streamKey("a1", "c1"), {
    kind: "turn",
    dispose: () => {},
    stopUnsent: () => false, // accepted: the engine stops it
  });

  expect(await c.cancel("c1", "a1")).toEqual({ ok: true, cancelled: false });
});
