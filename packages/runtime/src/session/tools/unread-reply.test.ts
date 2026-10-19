import { expect, test } from "vitest";
import { unreadReplyInstruction } from "./unread-reply";

test("with nothing visible this turn it asks for everything prepared this turn", () => {
  expect(unreadReplyInstruction(" \n\n")).toBe(
    "The user never sees your reasoning or tool results. Your messages from earlier turns are still on their screen. So far this turn they have read nothing from you, so anything you found or prepared for them this turn (an answer, a link, a draft, findings) is not 'above': write it out in full in your closing message.",
  );
});

test("quotes the visible text verbatim between markers", () => {
  expect(
    unreadReplyInstruction("\nHere is the sheet: https://x.test/s\n"),
  ).toBe(
    "The user never sees your reasoning or tool results. Your messages from earlier turns are still on their screen. What they have read from you this turn is quoted here, verbatim:\n<read_by_user>\nHere is the sheet: https://x.test/s\n</read_by_user>\nDo not repeat it. Anything you found or prepared for them this turn that is not in that quote (an answer, a link, a draft, findings) is not 'above': write it out in full in your closing message.",
  );
});

test("a very long reply keeps its newest 6000 characters and says the cut part was read", () => {
  const text = unreadReplyInstruction(
    `Link: https://x.test/s ${"b".repeat(6000)}`,
  );
  expect(text).toContain(
    `<read_by_user>\n[earlier text, also already read, cut here] ${"b".repeat(6000)}\n</read_by_user>`,
  );
  expect(text).not.toContain("https://x.test/s");
});

test("the cut never splits an emoji into a lone surrogate", () => {
  const text = unreadReplyInstruction(`x${"😀".repeat(6000)}`);
  expect(text).toContain(`cut here] ${"😀".repeat(6000)}\n`);
});
