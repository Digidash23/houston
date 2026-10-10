import type { BrowserLiveKey } from "@houston/wire-types";

/**
 * Windows virtual key codes per special key, and the text the key types.
 * Chromium needs the codes for focus moves, form submits and deletes; a key
 * with text is a `keyDown` (it types), one without is a `rawKeyDown`.
 */
const KEYS: Record<BrowserLiveKey, readonly [code: number, text?: string]> = {
  Enter: [13, "\r"],
  Tab: [9],
  Backspace: [8],
  Delete: [46],
  Escape: [27],
  ArrowLeft: [37],
  ArrowUp: [38],
  ArrowRight: [39],
  ArrowDown: [40],
  Home: [36],
  End: [35],
  PageUp: [33],
  PageDown: [34],
};

export interface KeyEventParams {
  type: "keyDown" | "rawKeyDown" | "keyUp";
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  unmodifiedText?: string;
}

/** The CDP `Input.dispatchKeyEvent` pair (down, up) for one special key. */
export function keyPress(
  key: BrowserLiveKey,
  modifiers = 0,
): [KeyEventParams, KeyEventParams] {
  const [code, text] = KEYS[key];
  const base = {
    key,
    code: key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
    modifiers,
  };
  return [
    text
      ? { type: "keyDown", text, unmodifiedText: text, ...base }
      : { type: "rawKeyDown", ...base },
    { type: "keyUp", ...base },
  ];
}
