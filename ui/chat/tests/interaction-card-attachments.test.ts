// PRODUCT-2132: a question card that replaces the composer carries the
// ChatPanel's ONE attachment list. Mounted inside a real ChatPanel (the seam
// under test is the panel handing its list to its composer-replacing slot).

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mountLog, win } from "./support/conversation-log-dom.ts";

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChatPanel } = await import("../src/chat-panel.tsx");
const { ChatInteractionCard } = await import("../src/interaction-card.tsx");
type CardProps = import("../src/interaction-card.tsx").ChatInteractionCardProps;
type Answer = import("../src/interaction-card-logic.ts").ChatInteractionAnswer;

const PICK: CardProps["steps"][number] = {
  kind: "question",
  id: "q-photo",
  question: "Which character?",
  options: [
    { id: "fox", label: "The fox" },
    { id: "owl", label: "The owl" },
  ],
};
const OPEN: CardProps["steps"][number] = {
  kind: "question",
  id: "q-image",
  question: "Send me its image",
};

const photo = new win.File(["png"], "photo.png", {
  type: "image/png",
}) as unknown as File;

interface Completion {
  answers: Answer[];
  files: File[];
}

function card(
  steps: CardProps["steps"],
  done: Completion[],
  labels?: CardProps["labels"],
) {
  return h(ChatInteractionCard, {
    steps,
    labels,
    onComplete: (answers: Answer[], files: File[]) =>
      done.push({ answers, files }),
    renderConnect: () => null,
    renderSignin: () => null,
    renderCredential: () => null,
  });
}

function panel(
  override: ReturnType<typeof card>,
  extra: Record<string, unknown> = {},
) {
  return h(ChatPanel, {
    sessionKey: "s",
    feedItems: [{ feed_type: "user_message", id: "a", data: "Animate it" }],
    isLoading: false,
    status: "ready",
    onSend: async () => {},
    composerOverrideMode: "replace",
    composerOverride: override,
    ...extra,
  });
}

const byLabel = (label: string) =>
  win.document.querySelectorAll(`[aria-label="${label}"]`);

function click(el: Element | null | undefined): void {
  assert.ok(el, "element to click is missing");
  act(() => {
    (el as HTMLElement).click();
  });
}

function pick(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => {
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
}

describe("question card attachments", () => {
  it("shows the panel's files and hands them over with a picked option", () => {
    const done: Completion[] = [];
    const changes: File[][] = [];
    mountLog(
      panel(card([PICK], done), {
        attachments: [photo],
        onAttachmentsChange: (files: File[]) => changes.push(files),
      }),
    );
    assert.equal(byLabel("Attach files").length, 1);
    assert.equal(byLabel("Remove photo.png").length, 1);

    const fox = Array.from(
      win.document.querySelectorAll('[role="radio"]'),
    ).find((el) => el.textContent?.includes("The fox"));
    click(fox);

    assert.equal(done.length, 1);
    assert.deepEqual(
      done[0].answers.map((a) => a.answer),
      ["The fox"],
    );
    assert.deepEqual(done[0].files, [photo]);
    assert.deepEqual(changes, [[]]);
  });

  it("answers a free-text question with a picked file and no words", () => {
    const done: Completion[] = [];
    mountLog(panel(card([OPEN], done, { attachedAnswer: "Ver adjunto" })));
    const send = byLabel("Send")[0] as HTMLButtonElement;
    assert.equal(send.disabled, true);

    const input = win.document.querySelector(
      'input[type="file"]:not([webkitdirectory])',
    ) as HTMLInputElement;
    pick(input, [photo]);
    assert.equal(byLabel("Remove photo.png").length, 1);
    assert.equal(send.disabled, false);

    click(send);
    assert.equal(done.length, 1);
    assert.deepEqual(done[0].answers, [
      {
        stepId: "q-image",
        question: "Send me its image",
        answer: "Ver adjunto",
        source: "text",
      },
    ]);
    assert.deepEqual(done[0].files, [photo]);
    assert.equal(byLabel("Remove photo.png").length, 0);
  });

  it("keeps the attach control when the question hides its free text", () => {
    mountLog(panel(card([{ ...PICK, hideFreeText: true }], [])));
    assert.equal(win.document.querySelectorAll("textarea").length, 0);
    assert.equal(byLabel("Attach files").length, 1);
  });

  it("leaves the attachments to the composer when the card sits above it", () => {
    mountLog(
      panel(card([PICK], []), {
        composerOverrideMode: "above",
        attachments: [photo],
      }),
    );
    // One "+" and one chip: the composer's. The card offers neither.
    assert.equal(byLabel("Attach files").length, 1);
    assert.equal(byLabel("Remove photo.png").length, 1);
    assert.ok(win.document.querySelector('textarea[name="message"]'));
  });

  it("offers no attach control outside a ChatPanel, and hands over no files", () => {
    const done: Completion[] = [];
    win.document.body.innerHTML = "";
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(card([PICK], done)));
    assert.equal(byLabel("Attach files").length, 0);
    const owl = Array.from(container.querySelectorAll('[role="radio"]')).find(
      (el) => el.textContent?.includes("The owl"),
    );
    click(owl);
    assert.deepEqual(done[0].files, []);
    act(() => root.unmount());
  });
});
