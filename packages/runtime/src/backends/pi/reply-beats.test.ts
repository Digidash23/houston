import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { createReplyBeatReader } from "./reply-beats";

const ev = (e: unknown) => e as AgentSessionEvent;

const assistant = (over: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [],
  stopReason: "stop",
  ...over,
});

const toolCall = (name: string) => ({
  type: "toolCall",
  id: `id-${name}`,
  name,
  arguments: {},
});

function toolcall(
  type: "toolcall_start" | "toolcall_delta",
  index: number,
  name: string,
) {
  const content: unknown[] = [{ type: "text", text: "Done." }];
  content[index] = toolCall(name);
  return ev({
    type: "message_update",
    message: assistant(),
    assistantMessageEvent: {
      type,
      contentIndex: index,
      partial: assistant({ content }),
      ...(type === "toolcall_delta" ? { delta: "{" } : {}),
    },
  });
}

const messageStart = () => ev({ type: "message_start", message: assistant() });

test("a tool call is reported once, at its toolcall_start", () => {
  const read = createReplyBeatReader();
  read(messageStart());
  expect(read(toolcall("toolcall_start", 1, "suggest_actions"))).toEqual({
    type: "tool_call_start",
    name: "suggest_actions",
  });
  expect(read(toolcall("toolcall_delta", 1, "suggest_actions"))).toBeNull();
});

test("a call unnamed at its start is reported on the first event that names it", () => {
  const read = createReplyBeatReader();
  read(messageStart());
  expect(read(toolcall("toolcall_start", 1, ""))).toBeNull();
  expect(read(toolcall("toolcall_delta", 1, "suggest_actions"))).toEqual({
    type: "tool_call_start",
    name: "suggest_actions",
  });
});

test("a new assistant message starts the reported set over", () => {
  const read = createReplyBeatReader();
  read(messageStart());
  read(toolcall("toolcall_start", 1, "Bash"));
  read(messageStart());
  expect(read(toolcall("toolcall_start", 1, "Bash"))).toEqual({
    type: "tool_call_start",
    name: "Bash",
  });
});

test("only a clean stop with no tool call is an answer end", () => {
  const read = createReplyBeatReader();
  const end = (message: unknown) => read(ev({ type: "message_end", message }));
  expect(end(assistant({ content: [{ type: "text", text: "Hi" }] }))).toEqual({
    type: "answer_end",
  });
  expect(
    end(assistant({ stopReason: "toolUse", content: [toolCall("Bash")] })),
  ).toBeNull();
  expect(end(assistant({ content: [toolCall("Bash")] }))).toBeNull();
  expect(end(assistant({ stopReason: "length" }))).toBeNull();
  expect(end(assistant({ stopReason: "error" }))).toBeNull();
  expect(end({ role: "user", content: "hi" })).toBeNull();
});
