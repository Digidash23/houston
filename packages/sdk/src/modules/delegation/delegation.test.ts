import type { AgentDelegation } from "@houston/wire-types";
import { describe, expect, it, vi } from "vitest";
import type { SdkConfig, SdkPorts } from "../../ports";
import { HoustonSdk } from "../../sdk";
import { memoryKv } from "../../test-ports";
import {
  DelegationCommand,
  type DelegationHttpError,
  delegationWithAccepts,
  delegationWithAgent,
  delegationWithMode,
  otherAddressableAgents,
} from "./index";

const policy: AgentDelegation = {
  mode: "picked",
  agents: ["Personal/Writer"],
  acceptsMissions: true,
};

function makeSdk(status = 200) {
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify(status === 200 ? policy : { error: "not manager" }),
        { status, headers: { "content-type": "application/json" } },
      ),
  );
  const ports: SdkPorts = {
    fetch: fetchImpl as typeof fetch,
    storage: memoryKv(),
    devicePreferences: memoryKv(),
    clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => {} },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const config: SdkConfig = {
    baseUrl: "http://host",
    ports,
    reactivity: false,
  };
  return { sdk: new HoustonSdk(config), fetchImpl };
}

describe("delegation", () => {
  it("uses the same facade for typed calls and commands", async () => {
    const { sdk, fetchImpl } = makeSdk();
    expect(await sdk.delegation.getAgentDelegation("a1")).toEqual(policy);
    const result = await sdk.dispatch({
      id: "1",
      type: DelegationCommand.Set,
      payload: { agentId: "a1", policy },
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify(policy),
    });
  });

  it("rejects malformed command policies before any request", async () => {
    const { sdk, fetchImpl } = makeSdk();
    const result = await sdk.dispatch({
      id: "2",
      type: DelegationCommand.Set,
      payload: { agentId: "a1", policy: { mode: "picked", agents: ["a2"] } },
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves an HTTP refusal and status", async () => {
    const { sdk } = makeSdk(403);
    await expect(sdk.delegation.getAgentDelegation("a1")).rejects.toMatchObject(
      {
        name: "DelegationHttpError",
        status: 403,
      } satisfies Partial<DelegationHttpError>,
    );
  });

  it("keeps policy transitions pure and clears lists outside picked mode", () => {
    expect(delegationWithMode(policy, "off")).toEqual({
      mode: "off",
      agents: [],
      acceptsMissions: true,
    });
    expect(delegationWithAgent(policy, "Personal/Writer", true)).toEqual(
      policy,
    );
    expect(
      delegationWithAgent(policy, "Personal/Writer", false).agents,
    ).toEqual([]);
    expect(delegationWithAccepts(policy, false).acceptsMissions).toBe(false);
    expect(policy.agents).toEqual(["Personal/Writer"]);
  });

  it("offers only other addressable agents", () => {
    const roster = [
      { id: "Personal/Scout" },
      { id: "Personal/Writer" },
      { id: "Personal/.hidden" },
    ];
    expect(otherAddressableAgents(roster, "Personal/Scout")).toEqual([
      roster[1],
    ]);
  });
});
