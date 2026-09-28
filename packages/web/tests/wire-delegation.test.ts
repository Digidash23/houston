import { HoustonClient } from "@houston/engine-adapter/client";
import { HoustonEngineError } from "@houston/engine-adapter/client/errors";
import type { AgentDelegation } from "@houston/wire-types";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createWireCapture,
  expectGatewayHeaders,
  installLocalStorage,
  json,
  ORG,
} from "./support/wire-capture";

const { calls, reset, restore, stubFetch } = createWireCapture();
const policy: AgentDelegation = {
  mode: "picked",
  agents: ["Personal/Writer"],
  acceptsMissions: true,
};

beforeEach(() => {
  installLocalStorage();
  reset();
});

afterEach(() => {
  restore();
  vi.clearAllMocks();
});

function client(controlPlane = true): HoustonClient {
  const c = new HoustonClient({
    baseUrl: "http://host",
    token: "t",
    controlPlane,
  });
  if (controlPlane) c.setActiveOrg(ORG);
  return c;
}

test("delegation GET and PUT use the encoded agent path and full policy body", async () => {
  stubFetch(() => json(200, policy));
  const c = client();

  await expect(c.getAgentDelegation("Personal/Scout")).resolves.toEqual(policy);
  await expect(c.setAgentDelegation("Personal/Scout", policy)).resolves.toEqual(
    policy,
  );

  expect(calls).toHaveLength(2);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "GET http://host/v1/agents/Personal%2FScout/delegation",
    "PUT http://host/v1/agents/Personal%2FScout/delegation",
  ]);
  expect(calls.map((call) => call.body)).toEqual([
    null,
    '{"mode":"picked","agents":["Personal/Writer"],"acceptsMissions":true}',
  ]);
  for (const call of calls) expectGatewayHeaders(call);
});

test("local clients use the same SDK method and surface refusals", async () => {
  stubFetch(() => json(403, { code: "not_manager", error: "not manager" }));
  await expect(client(false).getAgentDelegation("a1")).rejects.toThrow(
    HoustonEngineError,
  );
  expect(calls[0]?.url).toBe("http://host/v1/agents/a1/delegation");
});
