import { describe, expect, it } from "vitest";
import { startedMissionFromMcpText } from "./start-mission-receipt";

describe("startedMissionFromMcpText", () => {
  it("reads the receipt a start_mission result carries", () => {
    expect(
      startedMissionFromMcpText(
        '{"mission":{"id":"m1","title":"Chase invoices","agent":"ava"}}',
      ),
    ).toEqual({ id: "m1", title: "Chase invoices", agent: "ava" });
  });

  it("reads a result that only looks like a receipt as none", () => {
    expect(startedMissionFromMcpText('{"mission":oops')).toBeUndefined();
    expect(startedMissionFromMcpText('{"mission":{"id":"m1"')).toBeUndefined();
    expect(startedMissionFromMcpText("Mission started.")).toBeUndefined();
  });
});
