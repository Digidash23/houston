import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

/**
 * The long-lived server (standing pod, desktop) must keep pi's own transport,
 * `auto`: it serves a conversation's turns from one process, so pi's cached
 * Codex WebSocket skips the handshake on every turn after the first. Only a
 * pooled turn worker pins SSE (turn/turn-pi-transport.ts).
 */

const captured = vi.hoisted(() => ({
  transports: [] as (string | undefined)[],
}));

vi.mock("../backends/pi/backend", () => ({
  createPiBackend: (deps: { transport?: string }) => {
    captured.transports.push(deps.transport);
    return {
      id: "pi",
      createSession: () => {
        throw new Error("conversation-backends-transport.test runs no turn");
      },
    };
  },
}));

// Throwaway dirs BEFORE the module graph loads (config reads env at import).
process.env.HOUSTON_DATA_DIR = mkdtempSync(join(tmpdir(), "houston-cbt-data-"));
process.env.HOUSTON_WORKSPACE_DIR = mkdtempSync(
  join(tmpdir(), "houston-cbt-ws-"),
);

test("the server's pi backend names no transport, so pi keeps auto", async () => {
  await import("./conversation-backends");
  expect(captured.transports).toEqual([undefined]);
});
