import type { Api, Model } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { planForcedToolCall } from "./forced-tool-choice";

/**
 * The forced pass runs only where the provider honors a forced tool call;
 * every other model is `unsupported` so the turn never pays a request that
 * would mostly come back as text.
 */

function model(api: string, provider: string, over: object = {}): Model<Api> {
  // SAFETY: a fixture; only api/provider/reasoning/compat/thinkingLevelMap are read.
  return { api, provider, id: "m", ...over } as unknown as Model<Api>;
}

test("each allowlisted API gets its native forced form", () => {
  const cases: [Model<Api>, unknown, string | undefined][] = [
    [model("openai-codex-responses", "openai-codex"), "required", "minimal"],
    [
      model("openai-responses", "openai"),
      { type: "function", name: "suggest_actions" },
      "minimal",
    ],
    [
      model("azure-openai-responses", "azure-openai-responses"),
      { type: "function", name: "suggest_actions" },
      "minimal",
    ],
    [
      model("openai-completions", "openrouter"),
      { type: "function", function: { name: "suggest_actions" } },
      "minimal",
    ],
    [
      model("anthropic-messages", "anthropic", { reasoning: true }),
      { type: "tool", name: "suggest_actions" },
      // Anthropic refuses a forced tool beside thinking.
      undefined,
    ],
    [model("google-generative-ai", "google"), "any", "minimal"],
    [model("google-vertex", "google-vertex"), "any", "minimal"],
  ];
  for (const [m, toolChoice, reasoning] of cases)
    expect(planForcedToolCall(m, "suggest_actions")).toEqual({
      kind: "forced",
      toolChoice,
      reasoning,
    });
});

test("everything off the allowlist is unsupported, with a reason", () => {
  for (const m of [
    model("bedrock-converse-stream", "amazon-bedrock"),
    model("mistral-conversations", "mistral"),
    // Custom endpoints and unverified Completions hosts.
    model("openai-completions", "openai-compatible"),
    model("openai-completions", "deepseek"),
    model("openai-completions", "opencode"),
    // Gateways speaking a forcing API for some other upstream.
    model("openai-responses", "xai"),
    model("anthropic-messages", "minimax"),
    model("google-generative-ai", "opencode"),
    // Anthropic models whose thinking pi cannot turn off.
    model("anthropic-messages", "anthropic", {
      reasoning: true,
      compat: { supportsMidConvoEffort: true },
    }),
    model("anthropic-messages", "anthropic", {
      reasoning: true,
      thinkingLevelMap: { off: null },
    }),
    model("pi-messages", "radius"),
  ]) {
    const plan = planForcedToolCall(m, "suggest_actions");
    expect(plan.kind, `${m.provider} over ${m.api}`).toBe("unsupported");
    if (plan.kind === "unsupported") expect(plan.reason).not.toBe("");
  }
});
