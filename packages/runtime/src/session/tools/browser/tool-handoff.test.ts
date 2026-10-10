import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { runWithConversationId } from "../../conversation-context";
import { runWithTurnMode } from "../../turn-mode-context";
import { HandoffRegistry } from "./live/registry";
import { BrowserPool } from "./pool";
import { makeBrowserTool } from "./tool";

/** A pool that fails the test if anything reaches the browser. */
const noBrowser = () =>
  new BrowserPool({
    launch: () => Promise.reject(new Error("no browser should launch")),
  });

function handOver(liveView: boolean) {
  const tool = makeBrowserTool({
    workspaceDir: "/ws/Agent",
    liveView,
    pool: noBrowser(),
    handoffs: new HandoffRegistry(),
  });
  // SAFETY: the browser tool never reads its ExtensionContext.
  return tool.execute(
    "t",
    { action: "handoff", text: "Sign in" },
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
}

test("no live view here: handoff is a named refusal that says what to do", async () => {
  const result = await runWithConversationId("c1", () => handOver(false));
  expect(result.details).toMatchObject({
    ok: false,
    error: { code: "handoff_unavailable" },
  });
  expect(result.content[0]).toMatchObject({
    text: expect.stringMatching(/^ERROR handoff_unavailable: .*sign in to/),
  });
});

test("outside a conversation there is nobody to hand the browser to", async () => {
  const result = await handOver(true);
  expect(result.details).toMatchObject({
    ok: false,
    error: { code: "handoff_unavailable" },
  });
});

test("an Autopilot turn never waits on the person", async () => {
  await expect(
    runWithTurnMode({ current: "auto" }, () =>
      runWithConversationId("c1", () => handOver(true)),
    ),
  ).rejects.toThrow(/Autopilot mode, so you can no longer hand the browser/);
});

test("the description tells the model about handoff only when it is offered", () => {
  const describe = (liveView: boolean) =>
    makeBrowserTool({ workspaceDir: "/ws", liveView }).description;
  expect(describe(true)).toContain("call handoff");
  expect(describe(false)).not.toContain("handoff");
});
