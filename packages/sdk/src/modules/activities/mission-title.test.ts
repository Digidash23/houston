import { describe, expect, it, vi } from "vitest";
import {
  cleanGeneratedTitle,
  planMissionTitle,
  titleMissionFromClient,
} from "./mission-title";

const TITLE = { fallback: "Plan the launch...", text: "Plan the launch" };

describe("planMissionTitle", () => {
  it("leaves the title to the server only when the deployment says so", () => {
    expect(planMissionTitle({ missionTitleOnSend: true }, TITLE)).toEqual({
      send: TITLE,
      client: undefined,
    });
  });

  it.each([
    ["absent", {}],
    ["false", { missionTitleOnSend: false }],
    ["not loaded", null],
  ])("keeps the client flow when the flag is %s", (_label, caps) => {
    expect(planMissionTitle(caps, TITLE)).toEqual({
      send: undefined,
      client: TITLE,
    });
  });

  it("plans nothing for a mission with an explicit title", () => {
    expect(planMissionTitle({ missionTitleOnSend: true }, undefined)).toEqual({
      send: undefined,
      client: undefined,
    });
  });
});

describe("cleanGeneratedTitle", () => {
  it("limits noisy model output", () => {
    expect(
      cleanGeneratedTitle('"Plan the launch email campaign today please."'),
    ).toBe("Plan the launch email campaign today");
  });

  it("answers null for nothing usable", () => {
    expect(cleanGeneratedTitle(undefined)).toBeNull();
    expect(cleanGeneratedTitle('  ".."  ')).toBeNull();
  });
});

describe("titleMissionFromClient", () => {
  const ops = (answer: () => Promise<{ title: string }>) => ({
    suggestTitle: vi.fn(answer),
    rename: vi.fn(async () => undefined),
    warn: vi.fn(),
  });

  it("renames the card to the cleaned answer", async () => {
    const o = ops(async () => ({ title: " Launch plan. " }));
    await titleMissionFromClient(TITLE, o);
    expect(o.suggestTitle).toHaveBeenCalledWith("Plan the launch");
    expect(o.rename).toHaveBeenCalledWith("Launch plan");
  });

  it("writes nothing when the cleaned answer is the fallback", async () => {
    const o = ops(async () => ({ title: '"Plan the launch."' }));
    await titleMissionFromClient(
      { fallback: "Plan the launch", text: "Plan the launch" },
      o,
    );
    expect(o.rename).not.toHaveBeenCalled();
  });

  it("falls back to the truncation when the runtime fails or answers empty", async () => {
    const failed = ops(async () => {
      throw new Error("down");
    });
    await titleMissionFromClient(TITLE, failed);
    expect(failed.rename).toHaveBeenCalledWith("Plan the launch");

    const empty = ops(async () => ({ title: "   " }));
    await titleMissionFromClient(TITLE, empty);
    expect(empty.rename).toHaveBeenCalledWith("Plan the launch");
  });

  it("never throws: a failed rename is logged and the fallback stays", async () => {
    const o = ops(async () => ({ title: "Launch plan" }));
    o.rename.mockRejectedValueOnce(new Error("409"));
    await expect(titleMissionFromClient(TITLE, o)).resolves.toBeUndefined();
    expect(o.warn).toHaveBeenCalledWith(
      "[mission-title] keeping fallback title",
      "409",
    );
  });
});
