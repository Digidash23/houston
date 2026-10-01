import { expect, test, vi } from "vitest";
import { cancelLogin, loginPending, startLogin } from "./login";

// startLogin("anthropic") resolves the Claude CLI at this seam; null = the
// token paste flow, which waits on its user without spawning anything.
vi.mock("./anthropic-cli-binary", () => ({
  resolveClaudeCliBinary: () => null,
}));

// The host's idle probe reports this: a sign-in lives only in this process,
// so a pod slept while one waits on its user drops it.
test("a sign-in waiting on its user is pending until it settles", async () => {
  expect(loginPending()).toBe(false);

  const info = await startLogin("anthropic");
  expect(info.kind).toBe("auth_code");
  expect(loginPending()).toBe(true);

  cancelLogin("anthropic");
  expect(loginPending()).toBe(false);
  // Let the rejected paste promise unwind the flow.
  await new Promise((r) => setTimeout(r, 100));
});
