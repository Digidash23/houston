import { expect, test } from "vitest";
import { MessageGrantsSchema, messageRetryContent } from "./message-retry";

test("the wire grant enum accepts only deliberate operations", () => {
  expect(MessageGrantsSchema.safeParse(["createAgent"]).success).toBe(true);
  expect(MessageGrantsSchema.safeParse(["deleteAgent"]).success).toBe(false);
});

test("a retried nonce cannot change the grant on a user's message", () => {
  const body = { text: "hire", grants: ["createAgent"] };
  expect(messageRetryContent(body, "user")).not.toBe(
    messageRetryContent({ text: "hire" }, "user"),
  );
});
