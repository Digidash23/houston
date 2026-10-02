import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { writeAuthFile } from "../auth/auth-file";
import type { TurnBackendDeps } from "./turn-backend";
import type { TurnSessionRequest } from "./turn-session";

/**
 * The provider branch must never decide what the agent can do: a tool the turn
 * was granted has to reach the pi backend and the Claude backend alike. Both
 * factories are mocked here so the assertion is about the tool LISTS they are
 * handed, which nothing else can observe.
 */

const piTools = vi.fn<(names: string[]) => void>();
const claudeTools = vi.fn<(names: string[]) => void>();

const piPrompt = vi.fn<(prompt: string | undefined) => void>();
const piTransport = vi.fn<(transport: string | undefined) => void>();
const claudePrompt = vi.fn<(prompt: string | undefined) => void>();
const piRole = vi.fn<(role: string | null | undefined) => void>();
const claudeRole =
  vi.fn<
    (role: string | null | undefined, clamp: boolean | undefined) => void
  >();

vi.mock("../backends/pi/backend", () => ({
  createPiBackend: (deps: {
    customTools: { name: string }[];
    systemPrompt?: string;
    transport?: string;
    role?: string | null;
  }) => {
    piTools(deps.customTools.map((tool) => tool.name));
    piRole(deps.role);
    piPrompt(deps.systemPrompt);
    piTransport(deps.transport);
    return { id: "pi", createSession: () => Promise.reject(new Error("stub")) };
  },
}));

vi.mock("../backends/claude/backend", () => ({
  ClaudeBackendUnavailableError: class extends Error {},
  createClaudeBackend: (deps: {
    tools: { name: string }[];
    systemPrompt?: string;
    role?: string | null;
    personalAssistant?: boolean;
  }) => {
    claudeTools(deps.tools.map((tool) => tool.name));
    claudeRole(deps.role, deps.personalAssistant);
    claudePrompt(deps.systemPrompt);
    return {
      id: "anthropic",
      createSession: () => Promise.reject(new Error("stub")),
    };
  },
}));

function deps(): TurnBackendDeps {
  const turnRoot = mkdtempSync(join(tmpdir(), "turn-backend-tools-"));
  const workspaceDir = join(turnRoot, "workspace");
  const dataDir = join(turnRoot, "data");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeAuthFile(join(dataDir, "auth.json"), {
    anthropic: { type: "api_key", key: "sk-ant-api03-test" },
  });
  const turn: TurnSessionRequest = {
    conversationId: "c1",
    text: "hello",
    provider: "anthropic",
    emit: () => undefined,
    signal: undefined,
    turnId: "t1",
  };
  return {
    directories: { workspaceDir, dataDir, turnRoot },
    turn,
    modelRuntime: {} as ModelRuntime,
    toolSelection: { toolNames: ["run_code"], includeRunCode: true },
    codeSandbox: {
      name: "run_code",
    } as unknown as TurnBackendDeps["codeSandbox"],
    systemPrompt: "system",
  };
}

test("a granted run_code reaches BOTH the pi and the Claude tool list", async () => {
  const { createTurnBackend } = await import("./turn-backend");
  createTurnBackend("openai-codex", deps());
  createTurnBackend("anthropic", deps());
  expect(piTools.mock.calls[0]?.[0]).toContain("run_code");
  expect(claudeTools.mock.calls[0]?.[0]).toContain("run_code");
  // The turn's prompt describes the turn's capabilities on BOTH branches; the
  // pi branch used to fall back to the PROCESS's prompt instead.
  expect(piPrompt.mock.calls[0]?.[0]).toBe("system");
  expect(claudePrompt.mock.calls[0]?.[0]).toBe("system");
});

test("a pooled turn pins pi to SSE: the Codex WebSocket is never reused here", async () => {
  // turn/turn-pi-transport.ts: a single-use (or cross-conversation) worker
  // cannot reuse pi's per-session socket, so `auto` only costs a handshake and
  // a wait for the socket to die before pi's own SSE fallback.
  const { createTurnBackend } = await import("./turn-backend");
  piTransport.mockClear();
  createTurnBackend("openai-codex", deps());
  expect(piTransport.mock.calls).toEqual([["sse"]]);
});

test("both branches carry the follow-up tools the product prompt mandates", async () => {
  // The product prompt ends every non-blocking turn with suggest_actions and
  // offers saving work through suggest_reusable. A name in the allowlist with
  // no tool object behind it is invisible to the model, so the prompt would
  // order a call to a tool the turn does not have.
  const { createTurnBackend } = await import("./turn-backend");
  piTools.mockClear();
  claudeTools.mockClear();
  createTurnBackend("openai-codex", deps());
  createTurnBackend("anthropic", deps());
  for (const names of [
    piTools.mock.calls[0]?.[0],
    claudeTools.mock.calls[0]?.[0],
  ]) {
    expect(names).toContain("suggest_actions");
    expect(names).toContain("suggest_reusable");
  }
});

test("a coordinator turn tells BOTH branches its role", async () => {
  const { createTurnBackend } = await import("./turn-backend");
  piRole.mockClear();
  claudeRole.mockClear();
  const coordinator = deps();
  coordinator.turn.role = "coordinator";
  createTurnBackend("openai-codex", coordinator);
  createTurnBackend("anthropic", coordinator);
  expect(piRole.mock.calls[0]?.[0]).toBe("coordinator");
  // The Claude branch clamps its SDK built-ins with the same flag.
  expect(claudeRole.mock.calls[0]).toEqual(["coordinator", true]);
  createTurnBackend("openai-codex", deps());
  createTurnBackend("anthropic", deps());
  expect(piRole.mock.calls[1]?.[0]).toBeNull();
  expect(claudeRole.mock.calls[1]).toEqual([null, false]);
});
