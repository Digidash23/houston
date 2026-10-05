import { expect, test, vi } from "vitest";

vi.mock("../config", async (original) => {
  const actual = await original<typeof import("../config")>();
  return {
    ...actual,
    config: { ...actual.config, controlPlaneUrl: "", sandboxToken: "" },
  };
});

import { anthropicSharedLoginDir } from "./anthropic-login-dir";
import { serveModeOn } from "./serve";

test("a worker with serve mode off uses a throwaway Claude login dir", async () => {
  expect(serveModeOn()).toBe(false);
  expect(await anthropicSharedLoginDir()).toBeNull();
});
