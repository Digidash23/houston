/**
 * Keyboard input on the live browser stage, as page input. Pure: the stage's
 * hidden text field feeds it DOM-shaped samples.
 *
 * Special keys go by name with CDP modifier bits; everything else is inserted
 * text, read back from the hidden field, because that is the only path phone
 * keyboards, autocorrect and IMEs all take. Composition is left alone until it
 * ends, and Backspace on an empty field (where a phone keyboard sends no
 * keydown) arrives as `beforeinput`.
 */

import {
  BROWSER_LIVE_VIEW_KEYS,
  BROWSER_LIVE_VIEW_MODIFIER,
  type BrowserLiveViewInput,
  type BrowserLiveViewKey,
} from "./browser-live-types";

export interface BrowserLiveKeySample {
  key: string;
  isComposing: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const SPECIAL: ReadonlySet<string> = new Set(BROWSER_LIVE_VIEW_KEYS);

function isSpecialKey(key: string): key is BrowserLiveViewKey {
  return SPECIAL.has(key);
}

export function modifierBits(sample: BrowserLiveKeySample): number {
  return (
    (sample.altKey ? BROWSER_LIVE_VIEW_MODIFIER.alt : 0) |
    (sample.ctrlKey ? BROWSER_LIVE_VIEW_MODIFIER.ctrl : 0) |
    (sample.metaKey ? BROWSER_LIVE_VIEW_MODIFIER.meta : 0) |
    (sample.shiftKey ? BROWSER_LIVE_VIEW_MODIFIER.shift : 0)
  );
}

/**
 * The key event a keydown sends, or null when the keystroke should reach the
 * hidden field as text (the caller then lets the default happen).
 */
export function keyDownInput(
  sample: BrowserLiveKeySample,
): BrowserLiveViewInput | null {
  if (sample.isComposing || !isSpecialKey(sample.key)) return null;
  const modifiers = modifierBits(sample);
  return modifiers === 0
    ? { type: "key", key: sample.key }
    : { type: "key", key: sample.key, modifiers };
}

/**
 * A phone keyboard's Backspace on an empty field fires `beforeinput` and no
 * usable keydown: send it by name so the page still deletes.
 */
export function beforeInputKey(
  inputType: string,
  fieldValue: string,
): BrowserLiveViewInput | null {
  return inputType === "deleteContentBackward" && fieldValue === ""
    ? { type: "key", key: "Backspace" }
    : null;
}

/** Whatever sits in the hidden field, as one text event (null when empty). */
export function textInput(value: string): BrowserLiveViewInput | null {
  return value ? { type: "text", text: value } : null;
}
