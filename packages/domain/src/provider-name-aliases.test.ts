import { expect, test } from "vitest";
import { PROVIDER_ALIASES } from "./provider-name-aliases";

// The hosted gateway mirrors this table to look a routine's pin up under the
// provider id the worker will run it as. A change here must land in the
// gateway's copy in the same sitting: an alias the gateway lacks makes every
// fire of a routine pinned to it fall back instead of running.
test("the alias table is exactly what the hosted gateway mirrors", () => {
  expect({ ...PROVIDER_ALIASES }).toStrictEqual({
    openai: "openai-codex",
    codex: "openai-codex",
    chatgpt: "openai-codex",
    claude: "anthropic",
    gemini: "google",
    bedrock: "amazon-bedrock",
    copilot: "github-copilot",
  });
});
