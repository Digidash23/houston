import { afterEach, expect, test, vi } from "vitest";
import { assistantRuntimeRole } from "../launcher/assistant-role";
import type { CredentialVault } from "../ports";
import { assistantClaim } from "../routes/assistant-claim";
import { resolveAssistantGateway } from "../routes/assistant-wiring";
import { gatewayAgentSlug, runAsCoordinator } from "./coordinator-scope";

/**
 * A pool worker runs the host's own operation and mission handlers for
 * Houston's turn. It has no pod environment to say "this is the coordinator",
 * so the turn hands the identity to exactly the calls it makes, and nothing
 * outside them sees it.
 */

const vault: CredentialVault = {
  sandboxToken: () => "token",
  validateSandboxToken: (agentId) => ({ workspaceId: "w", agentId }),
};
const SCOPE = {
  userId: "owner-1",
  agentSlug: "a551abcdef012345",
  gateway: { url: "https://gateway.test/", token: "assistant-turn-v1.x.y" },
};

afterEach(() => vi.unstubAllEnvs());

test("inside the scope the host answers as the coordinator", () => {
  vi.stubEnv("HOUSTON_MANAGED_CLOUD", "1");
  vi.stubEnv("HOUSTON_ASSISTANT_USER_ID", "");
  vi.stubEnv("HOUSTON_ASSISTANT_CP_URL", "");
  vi.stubEnv("HOUSTON_ASSISTANT_TOKEN", "");
  vi.stubEnv("HOUSTON_AGENT_SLUG", "");
  runAsCoordinator(SCOPE, () => {
    expect(assistantRuntimeRole({ agentId: "ws/Assistant" })).toBe(
      "coordinator",
    );
    expect(
      assistantClaim(vault, "ws/Assistant", { gatewayFronted: true }),
    ).toEqual({ workspaceId: "w", agentId: "ws/Assistant" });
    // The turn's own credential, never marked as this host calling itself.
    expect(resolveAssistantGateway()).toEqual({
      url: "https://gateway.test",
      token: "assistant-turn-v1.x.y",
    });
    expect(gatewayAgentSlug()).toBe("a551abcdef012345");
  });
});

test("outside the scope nothing changes", () => {
  vi.stubEnv("HOUSTON_MANAGED_CLOUD", "1");
  vi.stubEnv("HOUSTON_ASSISTANT_USER_ID", "");
  vi.stubEnv("HOUSTON_ASSISTANT_CP_URL", "");
  vi.stubEnv("HOUSTON_ASSISTANT_TOKEN", "");
  vi.stubEnv("HOUSTON_AGENT_SLUG", "writer-slug");
  runAsCoordinator(SCOPE, () => undefined);
  expect(assistantRuntimeRole({ agentId: "ws/Writer" })).toBeNull();
  expect(
    assistantClaim(vault, "ws/Writer", { gatewayFronted: true }),
  ).toBeNull();
  expect(resolveAssistantGateway()).toBeNull();
  expect(gatewayAgentSlug()).toBe("writer-slug");
});

test("concurrent calls each see only their own scope", async () => {
  const other = { ...SCOPE, userId: "owner-2", agentSlug: "a551ffffffffffff" };
  const seen = await Promise.all([
    runAsCoordinator(SCOPE, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return gatewayAgentSlug();
    }),
    runAsCoordinator(other, async () => gatewayAgentSlug()),
  ]);
  expect(seen).toEqual(["a551abcdef012345", "a551ffffffffffff"]);
});
