// The chat's small chrome controls (composer send and attach, the header's
// overflow menu, the suggested-actions dismiss) keep their desktop boxes but
// must reach a 44px touch target on a phone. They do it with an ::after
// hit-slop that moves no pixel and is dropped at the md: (desktop) edge. This
// suite reads the rendered classes and checks the arithmetic, so a later
// resize of a box (or a trimmed inset) cannot silently shrink the target.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptInputSubmit } from "../src/ai-elements/prompt-input.tsx";
import { ChatInputAttachButton } from "../src/chat-input-attachments.tsx";
import { ChatSuggestActions } from "../src/chat-suggest-actions.tsx";
import { ConversationActionsMenu } from "../src/conversation-actions-menu.tsx";
import { DEFAULT_CONVERSATION_MAP_LABELS } from "../src/conversation-map-labels.ts";

Object.assign(globalThis, { React });
const { createElement } = React;

const MIN_TOUCH_TARGET_PX = 44;
const TAILWIND_UNIT_PX = 4;

function buttonClasses(element: React.ReactElement, label: string): string[] {
  const doc = new JSDOM(renderToStaticMarkup(element)).window.document;
  const button = doc.querySelector(`button[aria-label="${label}"]`);
  assert.ok(button, `no button labelled ${label}`);
  return (button.getAttribute("class") ?? "").split(/\s+/);
}

/** The smaller side of the rendered box, from `size-N` or `h-N`/`w-N`. */
function boxPx(classes: string[]): number {
  const units = (prefix: string) =>
    classes
      .filter((c) => c.startsWith(prefix))
      .map((c) => Number(c.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
  const sides = [...units("size-"), ...units("h-"), ...units("w-")];
  assert.ok(sides.length > 0, `no box size in ${classes.join(" ")}`);
  return Math.min(...sides) * TAILWIND_UNIT_PX;
}

function phoneTargetPx(classes: string[]): number {
  const inset = classes.find((c) => c.startsWith("after:-inset-"));
  assert.ok(inset, "no ::after hit-slop");
  const slop = Number(inset.slice("after:-inset-".length)) * TAILWIND_UNIT_PX;
  return boxPx(classes) + 2 * slop;
}

function assertPhoneTarget(classes: string[]): void {
  assert.ok(classes.includes("relative"), "hit-slop needs a positioned box");
  assert.ok(classes.includes("after:absolute"));
  assert.ok(
    classes.includes("md:after:hidden"),
    "desktop keeps its own box: the slop must stop at md:",
  );
  assert.ok(
    phoneTargetPx(classes) >= MIN_TOUCH_TARGET_PX,
    `phone target ${phoneTargetPx(classes)}px < ${MIN_TOUCH_TARGET_PX}px`,
  );
  assert.ok(classes.includes("active:scale-[0.96]"), "no press feedback");
}

describe("phone tap targets in chat chrome", () => {
  it("composer send reaches 44px on a phone", () => {
    assertPhoneTarget(
      buttonClasses(createElement(PromptInputSubmit, {}), "Submit"),
    );
  });

  it("composer attach reaches 44px on a phone", () => {
    assertPhoneTarget(
      buttonClasses(
        createElement(ChatInputAttachButton, {
          onOpenFilePicker: () => undefined,
          onOpenFolderPicker: () => undefined,
        }),
        "Attach files",
      ),
    );
  });

  it("the header's chat actions trigger reaches 44px on a phone", () => {
    assertPhoneTarget(
      buttonClasses(
        createElement(ConversationActionsMenu, {
          canFind: true,
          labels: DEFAULT_CONVERSATION_MAP_LABELS,
          onFind: () => undefined,
        }),
        DEFAULT_CONVERSATION_MAP_LABELS.moreActions,
      ),
    );
  });

  it("the suggested actions dismiss reaches 44px on a phone", () => {
    assertPhoneTarget(
      buttonClasses(
        createElement(ChatSuggestActions, {
          actions: [{ id: "a", label: "Summarize", message: "Summarize" }],
          onSelect: () => undefined,
          onDismiss: () => undefined,
        }),
        "Dismiss suggested actions",
      ),
    );
  });
});
