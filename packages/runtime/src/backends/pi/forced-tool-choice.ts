import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";

/**
 * Whether a model's request can be FORCED to call one named tool, and how.
 *
 * An explicit allowlist: a forced call is worth its request only where the
 * provider honors the native forced form. Everywhere else the model would
 * just be asked, mostly answer in text, and the turn's `done` would wait up
 * to the pass's cap for nothing, so the pass does not run at all.
 */
export type ForcingPlan =
  | {
      kind: "forced";
      /** The API's native forced `tool_choice`, forwarded verbatim by pi. */
      toolChoice: unknown;
      /** The effort the forced request runs at (undefined: thinking off). */
      reasoning: ThinkingLevel | undefined;
    }
  | { kind: "unsupported"; reason: string };

/**
 * OpenAI Chat Completions providers documented to honor a named
 * `tool_choice`. A gateway or provider missing here (custom endpoints, local
 * models, unverified hosts) is unsupported.
 */
const COMPLETIONS_FORCING_PROVIDERS: readonly string[] = [
  "openrouter",
  "groq",
  "cerebras",
  "together",
  "fireworks",
];

export function planForcedToolCall(
  model: Model<Api>,
  toolName: string,
): ForcingPlan {
  const unsupported = (reason: string): ForcingPlan => ({
    kind: "unsupported",
    reason,
  });
  // The cheapest effort that still answers; pi clamps it per model (Codex
  // models map it to `low`).
  const forced = (toolChoice: unknown): ForcingPlan => ({
    kind: "forced",
    toolChoice,
    reasoning: "minimal",
  });
  switch (model.api) {
    // pi types Codex's `tool_choice` as auto/none/required: `required`, and
    // the instruction names the tool.
    case "openai-codex-responses":
      return forced("required");
    case "openai-responses":
      return model.provider === "openai"
        ? forced({ type: "function", name: toolName })
        : unsupported(`${model.provider} over openai-responses`);
    case "azure-openai-responses":
      return forced({ type: "function", name: toolName });
    case "openai-completions":
      return COMPLETIONS_FORCING_PROVIDERS.includes(model.provider)
        ? forced({ type: "function", function: { name: toolName } })
        : unsupported(`${model.provider} over openai-completions`);
    case "anthropic-messages":
      if (model.provider !== "anthropic")
        return unsupported(`${model.provider} over anthropic-messages`);
      // Anthropic refuses a forced tool beside extended thinking, and pi
      // keeps thinking on for a model that cannot turn it off.
      return anthropicThinkingCanBeOff(model)
        ? {
            kind: "forced",
            toolChoice: { type: "tool", name: toolName },
            reasoning: undefined,
          }
        : unsupported("anthropic model whose thinking cannot be turned off");
    case "google-generative-ai":
      return model.provider === "google"
        ? forced("any")
        : unsupported(`${model.provider} over google-generative-ai`);
    case "google-vertex":
      return forced("any");
    default:
      return unsupported(`no forced tool choice on ${model.api}`);
  }
}

/** Mid-conversation effort models always run adaptive thinking in pi. */
function anthropicThinkingCanBeOff(model: Model<Api>): boolean {
  if (!model.reasoning) return true;
  const compat: object | undefined = model.compat;
  if (
    compat &&
    "supportsMidConvoEffort" in compat &&
    compat.supportsMidConvoEffort === true
  )
    return false;
  return model.thinkingLevelMap?.off !== null;
}
