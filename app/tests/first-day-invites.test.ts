import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { firstDayInviteIds } from "../src/components/shell/first-day-invites.ts";

const agents = [
  { id: "new", folderPath: "/w/new" },
  { id: "legacy", folderPath: "/w/legacy" },
  { id: "busy", folderPath: "/w/busy" },
  { id: "unread", folderPath: "/w/unread" },
];

describe("firstDayInviteIds", () => {
  it("invites only a confirmed-empty employee whose first day is pending", () => {
    const ids = firstDayInviteIds({
      agents,
      history: (id) =>
        id === "busy" ? "some" : id === "unread" ? "unknown" : "none",
      canStart: () => true,
      firstDay: (path) => (path === "/w/new" ? "pending" : undefined),
    });
    deepStrictEqual([...ids], ["new"]);
  });

  it("never invites someone who may not start it", () => {
    const ids = firstDayInviteIds({
      agents,
      history: () => "none",
      canStart: (agent) => agent.id !== "new",
      firstDay: () => "pending",
    });
    deepStrictEqual([...ids], ["legacy", "busy", "unread"]);
  });
});
