import { Type } from "typebox";

const PAGE_ACTIONS = [
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

export const BROWSER_ACTION_NAMES = [...PAGE_ACTIONS, "handoff"] as const;
export type BrowserActionName = (typeof BROWSER_ACTION_NAMES)[number];

const ACTIONS_LEAD =
  "open a url; snapshot the page; click/fill/select an element by ref; press a key; wait for text or a pause; back; screenshot; close the browser (saves sign-ins)";

/**
 * Flat on purpose: a top-level union is not a valid function schema for most
 * providers, and the Claude bridge converts only object shapes. Which fields
 * each action needs is checked by `parseBrowserAction`. `handoff` is listed
 * only where a person can be shown the browser, so a model elsewhere never
 * sees an action it could not use.
 */
export function browserParameters({ handoff }: { handoff: boolean }) {
  const names: readonly BrowserActionName[] = handoff
    ? BROWSER_ACTION_NAMES
    : PAGE_ACTIONS;
  return Type.Object({
    action: Type.Union(
      names.map((name) => Type.Literal(name)),
      {
        description: handoff
          ? `${ACTIONS_LEAD}; handoff: let the person use this browser themselves (to sign in, enter a code, or solve a captcha) and wait until they finish.`
          : `${ACTIONS_LEAD}.`,
      },
    ),
    url: Type.Optional(
      Type.String({
        description: handoff
          ? "For open. For handoff: optionally, the page to show the person first."
          : "For open.",
      }),
    ),
    ref: Type.Optional(
      Type.String({
        description:
          "For click/fill/select: the element's ref from the LATEST snapshot, exactly as printed, e.g. s3e12.",
      }),
    ),
    text: Type.Optional(
      Type.String({
        description: handoff
          ? "For fill: what to type. For wait: text to wait for. For handoff: what the person needs to do, in one short sentence they will read."
          : "For fill: what to type. For wait: text to wait for.",
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
}

/**
 * The flat parameters as the tool receives them. Written out, not derived:
 * the action list is built per runtime, which TypeBox cannot type statically.
 */
export interface BrowserParams {
  action: BrowserActionName;
  url?: string;
  ref?: string;
  text?: string;
  value?: string;
  key?: string;
  ms?: number;
}
