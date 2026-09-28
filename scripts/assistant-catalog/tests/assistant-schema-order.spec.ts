import { describe, expect, it } from "vitest";
import { literalsInOrder } from "../assistant-schema.ts";

describe("union literal order", () => {
  it("reads a union's literals alphabetically, whatever order the checker listed them in", () => {
    expect(
      literalsInOrder([
        { const: "custom", type: "string" },
        { const: "composio", type: "string" },
      ]),
    ).toEqual([
      { const: "composio", type: "string" },
      { const: "custom", type: "string" },
    ]);
  });

  it("keeps every other branch where it stood", () => {
    expect(
      literalsInOrder([
        { const: "widget", type: "string" },
        { type: "number" },
        { const: "gadget", type: "string" },
        { type: "string" },
      ]),
    ).toEqual([
      { const: "gadget", type: "string" },
      { type: "number" },
      { const: "widget", type: "string" },
      { type: "string" },
    ]);
  });
});
