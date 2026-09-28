import { describe, expect, it } from "vitest";
import { AgentsHttpError } from "./http";
import { isAgentNameTaken } from "./refusals";

/** The adapter's `HoustonEngineError` shape: status plus the parsed body. */
function adapterError(status: number, body: unknown): Error {
  return Object.assign(new Error(`engine error ${status}`), { status, body });
}

const TAKEN = {
  error: 'an agent named "Mia" already exists in this workspace',
  code: "name_taken",
};

describe("isAgentNameTaken", () => {
  it("recognizes the host's 409 name_taken from the adapter's parsed body", () => {
    expect(isAgentNameTaken(adapterError(409, TAKEN))).toBe(true);
  });

  it("recognizes the SDK's own error carrying the body as its message", () => {
    expect(
      isAgentNameTaken(new AgentsHttpError(JSON.stringify(TAKEN), 409)),
    ).toBe(true);
  });

  it("recognizes the gateway's code-less 409 create refusal", () => {
    expect(
      isAgentNameTaken(
        adapterError(409, { error: "an agent with this name already exists" }),
      ),
    ).toBe(true);
    expect(isAgentNameTaken(new AgentsHttpError("", 409))).toBe(true);
  });

  it("leaves a 409 naming another code, and every other status, a failure", () => {
    expect(
      isAgentNameTaken(
        adapterError(409, { error: "busy", code: "turn_running" }),
      ),
    ).toBe(false);
    expect(isAgentNameTaken(adapterError(400, TAKEN))).toBe(false);
    expect(isAgentNameTaken(new AgentsHttpError("missing 'name'", 400))).toBe(
      false,
    );
  });

  it("rejects anything that is not a status-bearing error", () => {
    expect(isAgentNameTaken(undefined)).toBe(false);
    expect(isAgentNameTaken("409")).toBe(false);
    expect(isAgentNameTaken(new Error("boom"))).toBe(false);
    expect(isAgentNameTaken({ status: 409, body: TAKEN })).toBe(false);
  });
});
