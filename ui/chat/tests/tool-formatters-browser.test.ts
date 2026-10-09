import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { GlobeIcon } from "lucide-react";
import { getToolDetail, getToolIcon } from "../src/tool-formatters.tsx";

describe("browser tool rows", () => {
  it("show the globe, on both the pi and the Claude (MCP) name", () => {
    strictEqual(getToolIcon("browser"), GlobeIcon);
    strictEqual(getToolIcon("mcp__houston__browser"), GlobeIcon);
  });

  it("name the site for an open, and nothing for a click", () => {
    strictEqual(
      getToolDetail("browser", {
        action: "open",
        url: "https://the-internet.herokuapp.com/secure",
      }),
      "the-internet.herokuapp.com",
    );
    strictEqual(
      getToolDetail("browser", { action: "click", ref: "e12" }),
      null,
    );
  });
});
