import { expect, test } from "vitest";
import { systemPromptFor } from "./resource-loader";

/**
 * The fallback base prompt every agent gets when no product prompt is
 * injected. The user's AI Manager is named Houston, so an AI Employee told
 * "You are Houston" would introduce itself as the manager.
 */

test("the fallback base prompt never names the agent Houston", () => {
  for (const mode of ["disabled", "local"] as const) {
    const prompt = systemPromptFor(mode);
    expect(prompt).toContain(
      "You are a friendly AI assistant inside Houston, working for a non-technical user.",
    );
    expect(prompt).not.toContain("You are Houston");
  }
});
