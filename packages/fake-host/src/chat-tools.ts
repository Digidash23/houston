/**
 * Tool calls a scripted turn makes before it replies, armed by
 * `/__test__/chat-tools` — how a spec makes "the agent hired someone and
 * started a mission" happen. Each call streams as the real runtime's
 * `tool_start` / `tool_end` pair and persists on the assistant reply as its
 * tool record, so a reload replays the same rows. One-shot: consumed by the
 * next turn.
 */

import type { ToolCallRecord } from "@houston/protocol";
import { type ChatChannel, publish } from "./chat-channel";

export interface ScriptedToolCall {
  name: string;
  args: unknown;
  content?: string;
  isError?: boolean;
  mission?: { id: string; title: string; agent: string };
}

let nextToolCalls: ScriptedToolCall[] = [];

export function setNextToolCalls(calls: ScriptedToolCall[]): void {
  nextToolCalls = calls;
}

/** The armed calls, disarmed as they are taken. */
export function takeToolCalls(): ScriptedToolCall[] {
  const calls = nextToolCalls;
  nextToolCalls = [];
  return calls;
}

/** Stream each call as its start and end frames, `pause` between frames,
 *  for as long as the turn is `live` (a cancel or kill ends it). */
export async function streamToolCalls(
  ch: ChatChannel,
  turnId: string,
  calls: readonly ScriptedToolCall[],
  pause: () => Promise<unknown>,
  live: () => boolean,
): Promise<void> {
  for (const call of calls) {
    if (!live()) return;
    publish(ch, {
      type: "tool_start",
      data: { name: call.name, args: call.args },
      turnId,
    });
    await pause();
    if (!live()) return;
    publish(ch, {
      type: "tool_end",
      data: {
        name: call.name,
        isError: call.isError ?? false,
        ...(call.content !== undefined ? { content: call.content } : {}),
        ...(call.mission ? { mission: call.mission } : {}),
      },
      turnId,
    });
    await pause();
  }
}

/** The calls as the assistant reply persists them. */
export function toolRecords(
  calls: readonly ScriptedToolCall[],
): ToolCallRecord[] {
  return calls.map((call) => ({
    name: call.name,
    input: call.args,
    ...(call.content !== undefined ? { result: call.content } : {}),
    ...(call.isError ? { isError: true } : {}),
    ...(call.mission ? { mission: call.mission } : {}),
  }));
}
