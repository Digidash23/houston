import { type Static, Type } from "typebox";
import { BrowserToolError } from "./errors";

export const BROWSER_ACTION_NAMES = [
  "open",
  "snapshot",
  "click",
  "fill",
  "select",
  "press",
  "wait",
  "back",
  "screenshot",
  "close",
] as const;

/**
 * Flat on purpose: a top-level union is not a valid function schema for most
 * providers, and the Claude bridge converts only object shapes. Which fields
 * each action needs is checked by {@link parseBrowserAction}.
 */
export const browserParameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("open"),
      Type.Literal("snapshot"),
      Type.Literal("click"),
      Type.Literal("fill"),
      Type.Literal("select"),
      Type.Literal("press"),
      Type.Literal("wait"),
      Type.Literal("back"),
      Type.Literal("screenshot"),
      Type.Literal("close"),
    ],
    {
      description:
        "open a url; snapshot the page; click/fill/select an element by ref; press a key; wait for text or a pause; back; screenshot; close the browser (saves sign-ins).",
    },
  ),
  url: Type.Optional(Type.String({ description: "For open." })),
  ref: Type.Optional(
    Type.String({
      description:
        "For click/fill/select: the element's ref from the LATEST snapshot, e.g. e12.",
    }),
  ),
  text: Type.Optional(
    Type.String({
      description: "For fill: what to type. For wait: text to wait for.",
    }),
  ),
  value: Type.Optional(
    Type.String({ description: "For select: the option to pick." }),
  ),
  key: Type.Optional(
    Type.String({
      description: "For press: a key such as Enter, Tab, Escape.",
    }),
  ),
  ms: Type.Optional(
    Type.Number({
      description: "For wait: milliseconds to pause (max 10000).",
    }),
  ),
});

export type BrowserParams = Static<typeof browserParameters>;

export type BrowserAction =
  | { action: "open"; url: string }
  | { action: "snapshot" }
  | { action: "back" }
  | { action: "screenshot" }
  | { action: "close" }
  | { action: "click"; ref: string }
  | { action: "fill"; ref: string; text: string }
  | { action: "select"; ref: string; value: string }
  | { action: "press"; key: string }
  | { action: "wait"; text?: string; ms?: number };

export const MAX_WAIT_MS = 10_000;

function required(params: BrowserParams, field: keyof BrowserParams): string {
  const value = params[field];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new BrowserToolError(
    "invalid_action",
    `The ${params.action} action needs '${field}'.`,
  );
}

/** A ref the model copied with its brackets ("[ref=e3]") still names e3. */
function refOf(params: BrowserParams): string {
  return required(params, "ref")
    .replace(/^\[?(?:ref=)?|\]$/g, "")
    .trim();
}

/** Narrow the flat parameters to the one action asked for, or refuse it. */
export function parseBrowserAction(params: BrowserParams): BrowserAction {
  switch (params.action) {
    case "open":
      return { action: "open", url: required(params, "url") };
    case "click":
      return { action: "click", ref: refOf(params) };
    case "fill":
      // Empty text is a real fill (clearing a field), so only absence refuses.
      if (typeof params.text !== "string")
        throw new BrowserToolError(
          "invalid_action",
          "The fill action needs 'text'.",
        );
      return { action: "fill", ref: refOf(params), text: params.text };
    case "select":
      return {
        action: "select",
        ref: refOf(params),
        value: required(params, "value"),
      };
    case "press":
      return { action: "press", key: required(params, "key") };
    case "wait": {
      const text = params.text?.trim();
      if (!text && params.ms === undefined)
        throw new BrowserToolError(
          "invalid_action",
          "The wait action needs 'text' to wait for, or 'ms' to pause.",
        );
      const ms =
        params.ms === undefined
          ? undefined
          : Math.min(Math.max(0, params.ms), MAX_WAIT_MS);
      return {
        action: "wait",
        ...(text ? { text } : {}),
        ...(ms !== undefined ? { ms } : {}),
      };
    }
    case "snapshot":
      return { action: "snapshot" };
    case "back":
      return { action: "back" };
    case "screenshot":
      return { action: "screenshot" };
    case "close":
      return { action: "close" };
    default:
      throw new BrowserToolError(
        "invalid_action",
        `Unknown action. Use one of: ${BROWSER_ACTION_NAMES.join(", ")}.`,
      );
  }
}
