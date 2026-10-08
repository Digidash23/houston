import { describe, expect, it } from "vitest";
import { apiStartMissionRequest, apiTryKeyRequest } from "./api-examples";

const baseUrl = "https://gateway.gethouston.ai/";

describe("apiTryKeyRequest", () => {
  it("lists agents with the new key", () => {
    expect(apiTryKeyRequest({ baseUrl, key: "hst_abc" })).toBe(
      'curl -s https://gateway.gethouston.ai/agents \\\n  -H "Authorization: Bearer hst_abc"',
    );
  });
});

describe("apiStartMissionRequest", () => {
  it("starts a mission in the employee's organization without a key", () => {
    const req = apiStartMissionRequest({
      baseUrl,
      agentId: "3f9a1c07b2e84d65",
      orgId: "8c41e7a0d39b2f16",
    });
    expect(req).toContain(
      "-X POST https://gateway.gethouston.ai/v1/agents/3f9a1c07b2e84d65/missions",
    );
    expect(req).toContain('-H "Authorization: Bearer $HOUSTON_API_KEY"');
    expect(req).toContain('-H "x-houston-org: 8c41e7a0d39b2f16"');
    expect(req).toContain('"input":');
    expect(req).not.toMatch(/hst_[0-9a-f]/);
  });
});
