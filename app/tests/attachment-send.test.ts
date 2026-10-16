import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  decodeAttachmentMessage,
  decodeInteractionAnswersMessage,
} from "@houston-ai/chat";
import { prepareAttachmentSend } from "../src/lib/attachment-message.ts";

const ANSWERS =
  '<!--houston:interaction-answers {"lines":[{"question":"Which character?","answer":"The fox"}]}-->\n\nWhich character?: The fox';

describe("prepareAttachmentSend", () => {
  it("saves the files and names them in the prompt and the queued preview", async () => {
    const saved: string[][] = [];
    const fox = new File(["png"], "fox.png", { type: "image/png" });
    const send = await prepareAttachmentSend("Here it is", [fox], (files) => {
      saved.push(files.map((f) => f.name));
      return Promise.resolve(["uploads/fox.png"]);
    });
    deepStrictEqual(saved, [["fox.png"]]);
    strictEqual(
      send.prompt,
      '<!--houston:attachments {"message":"Here it is","files":[{"path":"uploads/fox.png","name":"fox.png"}]}-->\n\nHere it is\n\n[User attached these files. Read them with the Read tool if needed:\n- uploads/fox.png]',
    );
    deepStrictEqual(send.queuedPreview, {
      text: "Here it is",
      attachmentNames: ["fox.png"],
    });
  });

  it("keeps an interaction card's answers decodable inside the attachment marker", async () => {
    const fox = new File(["png"], "fox.png", { type: "image/png" });
    const send = await prepareAttachmentSend(ANSWERS, [fox], () =>
      Promise.resolve(["uploads/fox.png"]),
    );
    const attached = decodeAttachmentMessage(send.prompt);
    deepStrictEqual(attached, {
      message: ANSWERS,
      files: [{ name: "fox.png", path: "uploads/fox.png" }],
    });
    deepStrictEqual(decodeInteractionAnswersMessage(attached?.message ?? ""), {
      lines: [{ question: "Which character?", answer: "The fox" }],
    });
  });
});
