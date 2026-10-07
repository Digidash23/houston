import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { expect, test } from "vitest";
import { buildSessionHooks, toolGateHook } from "./tool-gate-hook";
import { endTurnIfRequested } from "./turn-end-hook";

/**
 * The Claude backend's tool gate: a PreToolUse hook that holds every call,
 * built-in or MCP, until the pooled turn's deferred uploads are on disk.
 */

const input = {
  hook_event_name: "PreToolUse",
  tool_name: "Read",
  tool_input: { file_path: "uploads/photo.png" },
  session_id: "s",
  transcript_path: "/dev/null",
  cwd: "/",
} as unknown as PreToolUseHookInput;

test("the session hooks add the gate only when there is something to wait for", () => {
  expect(buildSessionHooks()).toEqual({
    PostToolBatch: [{ hooks: [endTurnIfRequested] }],
  });
  const gated = buildSessionHooks(async () => undefined);
  expect(Object.keys(gated).sort()).toEqual(["PostToolBatch", "PreToolUse"]);
  expect(gated.PreToolUse?.[0]?.timeout).toBe(600);
});

test("a tool call waits for the gate, then proceeds untouched", async () => {
  let open: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  let answered = false;
  const answer = toolGateHook(() => ready)(input, "tool-1", {
    signal: new AbortController().signal,
  }).then((output) => {
    answered = true;
    return output;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(answered).toBe(false);
  open();
  expect(await answer).toEqual({});
});

test("a failed gate or a stopped turn denies the call with its reason", async () => {
  const failed = await toolGateHook(async () => {
    throw new Error("uploads did not load");
  })(input, "tool-1", { signal: new AbortController().signal });
  expect(failed).toEqual({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "uploads did not load",
    },
  });

  const abort = new AbortController();
  abort.abort();
  const stopped = await toolGateHook(() => new Promise<void>(() => undefined))(
    input,
    "tool-1",
    { signal: abort.signal },
  );
  expect(stopped).toMatchObject({
    hookSpecificOutput: { permissionDecision: "deny" },
  });
});
