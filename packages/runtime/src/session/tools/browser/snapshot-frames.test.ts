import { expect, test } from "vitest";
import type { BrowserTab } from "./open-tab";
import { pageSnapshot } from "./snapshot";

/** A frame whose password lookup answers `values`, or fails. */
function frame(values: string[] | Error, detached = false) {
  return {
    isDetached: () => detached,
    locator: () => ({
      evaluateAll: async () => {
        if (values instanceof Error) throw values;
        return values;
      },
    }),
  };
}

function tabWith(frames: ReturnType<typeof frame>[]): BrowserTab {
  const page = {
    frames: () => frames,
    ariaSnapshot: async () => '- textbox "Password" [ref=e4]: Secret1',
    title: async () => "Sign in",
    url: () => "https://site.test/login?password=Secret1",
  };
  // SAFETY: pageSnapshot reads only these members of the tab and its page.
  return { page, generation: 0 } as unknown as BrowserTab;
}

test("an iframe that detached during the look does not fail the snapshot", async () => {
  const snapshot = await pageSnapshot(
    tabWith([
      frame(["Secret1"]),
      frame(new Error("frame.evaluateAll: Frame was detached"), true),
    ]),
  );
  expect(snapshot).toContain("[password hidden]");
  expect(snapshot).toContain(
    "Address: https://site.test/login?password=[hidden]",
  );
  expect(snapshot).not.toContain("Secret1");
});

test("a frame still attached whose passwords cannot be read fails rather than leak", async () => {
  await expect(
    pageSnapshot(tabWith([frame(new Error("evaluate broke"))])),
  ).rejects.toThrow("evaluate broke");
});
