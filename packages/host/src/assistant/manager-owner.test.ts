import { describe, expect, test } from "vitest";
import {
  actingMayRunRoutine,
  managedOwnerSub,
  managerOwner,
} from "./manager-owner";

const managerPod = {
  HOUSTON_MANAGED_CLOUD: "1",
  HOUSTON_ASSISTANT_USER_ID: "member",
  HOUSTON_USER_ID: "org-owner",
};
const agentPod = { HOUSTON_MANAGED_CLOUD: "1", HOUSTON_USER_ID: "org-owner" };

describe("managedOwnerSub", () => {
  test("an AI Manager pod records its own person", () => {
    expect(managedOwnerSub(managerPod)).toBe("member");
  });
  test("any other managed pod records the org owner", () => {
    expect(managedOwnerSub(agentPod)).toBe("org-owner");
  });
  test("a host outside managed cloud reads no manager", () => {
    expect(
      managerOwner({ HOUSTON_ASSISTANT_USER_ID: "member" }),
    ).toBeUndefined();
    expect(managedOwnerSub({})).toBeUndefined();
  });
});

describe("actingMayRunRoutine", () => {
  test("the recorded creator fires its routine anywhere", () => {
    expect(
      actingMayRunRoutine("org-owner", { created_by: "org-owner" }, agentPod),
    ).toBe(true);
  });
  test("on an AI Manager pod its own person fires a routine stamped with anyone", () => {
    expect(
      actingMayRunRoutine("member", { created_by: "org-owner" }, managerPod),
    ).toBe(true);
    expect(actingMayRunRoutine("member", {}, managerPod)).toBe(true);
  });
  test("nobody else fires it", () => {
    expect(
      actingMayRunRoutine("member", { created_by: "org-owner" }, agentPod),
    ).toBe(false);
    expect(
      actingMayRunRoutine("stranger", { created_by: "org-owner" }, managerPod),
    ).toBe(false);
    expect(actingMayRunRoutine(undefined, {}, managerPod)).toBe(false);
  });
});
