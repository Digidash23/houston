/**
 * The non-command half of the bridge: which shell the frontend is running in,
 * and the local Tauri events that never leave the desktop process. Neither
 * touches `invoke`, so neither belongs to a native-command category.
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  type Event,
  emit,
  listen,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/**
 * True when running inside the Tauri desktop shell, false in a plain
 * browser (the webapp / mobile PWA pointed at a remote engine).
 *
 * This is the load-bearing distinction for provider sign-in: only the
 * desktop app is co-located with its engine, so only there can a
 * provider CLI's `localhost` OAuth callback reach the user's browser.
 * Remote clients must request the headless device-code flow instead
 * (see the AI hub's `use-provider-connections`). Delegates to
 * `@tauri-apps/api`'s blessed check (the global `isTauri` flag the
 * webview sets) rather than poking internals ourselves.
 */
export function osIsTauri(): boolean {
  return isTauri();
}

/** The native mobile shells that wrap the web build (`packages/mobile`). */
export type NativeMobilePlatform = "ios" | "android";

declare global {
  interface Window {
    /** Set by the mobile shell's boot before the app graph loads; absent in
     *  the desktop app and in a plain browser. */
    __HOUSTON_SURFACE__?: NativeMobilePlatform;
  }
}

/**
 * Which native mobile shell the frontend runs in, or null on desktop and in a
 * plain browser. A mobile browser tab is NOT a native shell: it keeps the web
 * behavior (Stripe checkout, popup sign-in, browser notifications).
 */
export function osNativeMobilePlatform(): NativeMobilePlatform | null {
  if (typeof window === "undefined") return null;
  return window.__HOUSTON_SURFACE__ ?? null;
}

/** True inside the iOS or Android app (App Store / Play Store builds). */
export function osIsNativeMobile(): boolean {
  return osNativeMobilePlatform() !== null;
}

/**
 * Whether a URL opened with no click of its own (after a network wait) reaches
 * the browser without a pop-up warning. The desktop and mobile shells hand it
 * to the OS. A browser allows it only while the click's user activation is
 * still live; one without `navigator.userActivation` is tried anyway.
 */
export function osCanOpenUrlUnprompted(): boolean {
  if (osIsTauri() || osIsNativeMobile()) return true;
  return globalThis.navigator?.userActivation?.isActive !== false;
}

export function legacyListen<T>(
  event: string,
  handler: (ev: Event<T>) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}

export function legacyEmit(event: string, payload?: unknown): Promise<void> {
  return emit(event, payload);
}
