import { describe, expect, it } from "vitest";
import {
  isExpectedOrgChartShareRefusal,
  ORG_CHART_SHARE_REFUSALS,
  orgChartSharePublishedSchema,
  orgChartShareRefusalOf,
} from "./org-chart-share";

const ID = "AbCdEfGhIjKlMnOpQrSt_-";

describe("orgChartSharePublishedSchema", () => {
  it("reads the gateway's 201", () => {
    const body = {
      id: ID,
      imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
      pageUrl: `https://agents.gethouston.ai/o/${ID}`,
    };
    expect(orgChartSharePublishedSchema.parse(body)).toEqual(body);
  });

  it("reads the preview card's address when the upload carried one", () => {
    const body = {
      id: ID,
      imageUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/image`,
      previewUrl: `https://gateway.gethouston.ai/v1/org-chart-shares/${ID}/preview`,
      pageUrl: `https://agents.gethouston.ai/o/${ID}`,
    };
    expect(orgChartSharePublishedSchema.parse(body)).toEqual(body);
    expect(
      orgChartSharePublishedSchema.safeParse({
        ...body,
        previewUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("refuses an id that is not 22 base64url characters, or a non-web URL", () => {
    const ok = {
      id: ID,
      imageUrl: "https://g/x",
      pageUrl: "https://a/o/x",
    };
    expect(orgChartSharePublishedSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, id: "short" },
      { ...ok, id: `${ID.slice(1)}/` },
      { ...ok, pageUrl: "javascript:alert(1)" },
      { ...ok, imageUrl: undefined },
    ])
      expect(orgChartSharePublishedSchema.safeParse(bad).success).toBe(false);
  });
});

describe("orgChartShareRefusalOf", () => {
  it("names each refusal the route answers with", () => {
    expect(orgChartShareRefusalOf(400, '{"error":"invalid_title"}')).toBe(
      "invalid_title",
    );
    expect(orgChartShareRefusalOf(400, '{"error":"invalid_image"}')).toBe(
      "not_an_image",
    );
    expect(orgChartShareRefusalOf(400, '{"error":"no_file"}')).toBe(
      "not_an_image",
    );
    expect(orgChartShareRefusalOf(401)).toBe("signed_out");
    expect(orgChartShareRefusalOf(410, '{"error":"account_deleted"}')).toBe(
      "account_deleted",
    );
    expect(orgChartShareRefusalOf(404)).toBe("unavailable");
    expect(orgChartShareRefusalOf(413)).toBe("too_large");
    expect(orgChartShareRefusalOf(415)).toBe("not_an_image");
    expect(orgChartShareRefusalOf(429)).toBe("rate_limited");
    expect(orgChartShareRefusalOf(503)).toBe("unavailable");
  });

  it("leaves a server failure a failure", () => {
    expect(orgChartShareRefusalOf(500)).toBeNull();
    expect(orgChartShareRefusalOf(502)).toBeNull();
    expect(orgChartShareRefusalOf(400, "<html>")).toBeNull();
    expect(orgChartShareRefusalOf(410, '{"error":"gone"}')).toBeNull();
  });
});

describe("isExpectedOrgChartShareRefusal", () => {
  it("is quiet only for states nothing in Houston caused", () => {
    expect(
      ORG_CHART_SHARE_REFUSALS.filter(isExpectedOrgChartShareRefusal),
    ).toEqual([
      "unavailable",
      "rate_limited",
      "signed_out",
      "account_deleted",
      "offline",
      "timed_out",
    ]);
  });
});
