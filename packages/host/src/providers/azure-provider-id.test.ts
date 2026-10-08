import { expect, test } from "vitest";
import {
  CLOUD_CAPABILITIES,
  LOCAL_CAPABILITIES,
  MANAGED_CLOUD_CAPABILITIES,
} from "../capabilities";
import { buildProviderCatalog } from "./pi-catalog";

/**
 * pi 1.0.3 renamed its Azure provider to `azure`. Houston's wire, its gateway's
 * credential rows and model ceilings, stored pins and older desktop clients all
 * key Azure on `azure-openai-responses`, so the pi-ai patch reverts the rename
 * inside pi. These pin the host's two provider listings to the Houston id: a pi
 * bump that drops that hunk turns them red instead of silently orphaning every
 * Azure connection.
 */

test("GET /v1/catalog lists Azure as azure-openai-responses, never azure", () => {
  const ids = buildProviderCatalog().map((p) => p.id);
  expect(ids).toContain("azure-openai-responses");
  expect(ids).not.toContain("azure");
});

test("GET /v1/capabilities lists Azure as azure-openai-responses, never azure", () => {
  for (const caps of [
    LOCAL_CAPABILITIES,
    CLOUD_CAPABILITIES,
    MANAGED_CLOUD_CAPABILITIES,
  ]) {
    expect(caps.providers).toContain("azure-openai-responses");
    expect(caps.providers).not.toContain("azure");
  }
});
