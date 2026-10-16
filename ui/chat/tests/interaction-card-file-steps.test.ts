// PRODUCT-2132: every question that wants files is answered by its own files.
// A file a step already claimed stays with that step; the files attached on a
// later `wantsFiles` question are that question's answer, and only those show
// under its upload area. Every attached file still rides the final answer.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  attach,
  type Completion,
  card,
  chips,
  click,
  file,
  mountLog,
  OPEN,
  panel,
  type Step,
  sendButton,
  type,
} from "./support/card-attachments-harness.ts";

const LOGO: Step = {
  kind: "question",
  id: "q-logo",
  question: "Your logo?",
  wantsFiles: true,
};
const PHOTO: Step = {
  kind: "question",
  id: "q-photo",
  question: "A product photo?",
  wantsFiles: true,
};

const pairs = (c: Completion) => c.answers.map((a) => [a.stepId, a.answer]);

describe("a question that wants files", () => {
  it("is answered by its own files after another file question", () => {
    const done: Completion[] = [];
    const logo = file("logo.png");
    const photo = file("photo.png");
    mountLog(panel(card([LOGO, PHOTO], done)));
    attach([logo]);
    click(sendButton());

    // The logo answered the first question, so it neither shows here nor
    // answers this one.
    assert.equal(chips("logo.png"), 0);
    assert.equal(sendButton().disabled, true);
    attach([photo]);
    assert.equal(chips("photo.png"), 1);
    assert.equal(sendButton().disabled, false);
    click(sendButton());

    assert.equal(done.length, 1);
    assert.deepEqual(pairs(done[0]), [
      ["q-logo", "See attached"],
      ["q-photo", "See attached"],
    ]);
    assert.deepEqual(done[0].files, [logo, photo]);
  });

  it("is answered by its own files after a plain question answered with files", () => {
    const done: Completion[] = [];
    const brief = file("brief.pdf", "application/pdf");
    const photo = file("photo.png");
    mountLog(panel(card([OPEN, PHOTO], done)));
    attach([brief]);
    click(sendButton());

    assert.equal(sendButton().disabled, true);
    attach([photo]);
    assert.equal(sendButton().disabled, false);
    click(sendButton());

    assert.deepEqual(pairs(done[0]), [
      ["q-image", "See attached"],
      ["q-photo", "See attached"],
    ]);
    assert.deepEqual(done[0].files, [brief, photo]);
  });

  it("keeps a file sent with typed words on its own question", () => {
    const done: Completion[] = [];
    const logo = file("logo.png");
    const photo = file("photo.png");
    mountLog(panel(card([LOGO, PHOTO], done)));
    attach([logo]);
    type("here is my logo");
    click(sendButton());

    // The logo answered the first question, so it can't answer this one.
    assert.equal(chips("logo.png"), 0);
    assert.equal(sendButton().disabled, true);
    attach([photo]);
    click(sendButton());
    assert.deepEqual(
      done[0].answers.map((a) => a.answer),
      ["here is my logo", "See attached"],
    );
    assert.deepEqual(done[0].files, [logo, photo]);
  });
});
