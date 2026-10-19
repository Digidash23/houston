import { expect, test } from "vitest";
import { unreadReplyInstruction } from "./unread-reply";

test("with nothing visible this turn it says so and asks for what only it saw", () => {
  expect(unreadReplyInstruction(" \n\n")).toBe(
    "The user never sees your reasoning or tool results, from this turn or earlier ones. Your visible messages from earlier turns are still on their screen. So far this turn they have read nothing from you. Anything you found or prepared for them that exists only in your reasoning or tool results (an answer, a link, a draft, findings) is not 'above' or 'earlier': write it out in full in your closing message.",
  );
});

test("quotes the visible text verbatim between markers", () => {
  expect(
    unreadReplyInstruction("\nHere is the sheet: https://x.test/s\n"),
  ).toBe(
    "The user never sees your reasoning or tool results, from this turn or earlier ones. Your visible messages from earlier turns are still on their screen. What they have read from you this turn is quoted here, verbatim:\n<read_by_user>\nHere is the sheet: https://x.test/s\n</read_by_user>\nDo not repeat it. Anything you found or prepared for them that exists only in your reasoning or tool results (an answer, a link, a draft, findings) is not 'above' or 'earlier': write it out in full in your closing message.",
  );
});

test("a very long reply keeps its newest 6000 characters and never asks to repeat the cut part", () => {
  const text = unreadReplyInstruction(
    `Link: https://x.test/s ${"b".repeat(6000)}`,
  );
  expect(text).toContain(
    "they have read a long reply from you; its end is quoted here",
  );
  expect(text).toContain(
    `<read_by_user>\n[...] ${"b".repeat(6000)}\n</read_by_user>\nDo not repeat any of it, including the earlier part cut at [...]. Anything you found or prepared for them that exists only in your reasoning or tool results (an answer, a link, a draft, findings) is not 'above' or 'earlier': write it out in full in your closing message.`,
  );
  expect(text).not.toContain("https://x.test/s");
});

test("the cut never splits an emoji into a lone surrogate", () => {
  const text = unreadReplyInstruction(`x${"😀".repeat(6000)}`);
  expect(text).toContain(`[...] ${"😀".repeat(6000)}\n`);
});
