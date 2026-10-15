/**
 * Pointer input on the live browser stage, as page input. Pure: the stage
 * feeds it DOM-shaped samples plus the canvas geometry and sends what it
 * returns.
 *
 * - A mouse forwards down / move / up of the PRIMARY button only.
 *   PointerEvent.detail is always 0, so double and triple clicks are counted
 *   here (within 500 ms and 5 px of the previous press).
 * - A touch is either a tap (a click) or a drag (a scroll of the page, never a
 *   text selection); it turns into a scroll once it travels 10 px.
 * - Moves are throttled to one per 33 ms: the page only needs the latest
 *   position, and the input POST would otherwise carry dozens per batch.
 */

import {
  type BrowserLiveStageGeometry,
  normalizedPoint,
  pageScale,
} from "./browser-live-geometry";
import type { BrowserLiveViewInput } from "./browser-live-types";

export interface BrowserLivePointerSample {
  pointerType: string;
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
}

export interface BrowserLivePointerUp {
  events: BrowserLiveViewInput[];
  /** Whether to focus the hidden text field (raises the phone keyboard). */
  focusKeyboard: boolean;
}

export interface BrowserLivePointer {
  down(
    sample: BrowserLivePointerSample,
    geo: BrowserLiveStageGeometry,
    now: number,
  ): BrowserLiveViewInput[];
  move(
    sample: BrowserLivePointerSample,
    geo: BrowserLiveStageGeometry,
    now: number,
  ): BrowserLiveViewInput[];
  up(
    sample: BrowserLivePointerSample,
    geo: BrowserLiveStageGeometry,
  ): BrowserLivePointerUp;
  cancel(): void;
}

export const CLICK_WINDOW_MS = 500;
export const CLICK_SLOP_PX = 5;
export const TAP_SLOP_PX = 10;
export const MOVE_THROTTLE_MS = 33;

interface TouchTrack {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function createBrowserLivePointer(): BrowserLivePointer {
  let touch: TouchTrack | null = null;
  let lastMove = Number.NEGATIVE_INFINITY;
  let press = {
    at: Number.NEGATIVE_INFINITY,
    x: 0,
    y: 0,
    count: 1 as 1 | 2 | 3,
  };

  return {
    down(sample, geo, now) {
      if (sample.pointerType === "touch") {
        touch = {
          x: sample.clientX,
          y: sample.clientY,
          startX: sample.clientX,
          startY: sample.clientY,
          moved: false,
        };
        return [];
      }
      if (sample.button !== 0) return [];
      const near =
        Math.hypot(sample.clientX - press.x, sample.clientY - press.y) <
        CLICK_SLOP_PX;
      const repeat = now - press.at < CLICK_WINDOW_MS && near;
      const count = (repeat ? Math.min(3, press.count + 1) : 1) as 1 | 2 | 3;
      press = { at: now, x: sample.clientX, y: sample.clientY, count };
      return [
        {
          type: "mouse",
          action: "down",
          clickCount: count,
          ...normalizedPoint(sample.clientX, sample.clientY, geo),
        },
      ];
    },

    move(sample, geo, now) {
      if (touch && sample.pointerType === "touch") {
        const travelled = Math.hypot(
          sample.clientX - touch.startX,
          sample.clientY - touch.startY,
        );
        if (!touch.moved && travelled < TAP_SLOP_PX) return [];
        const scale = pageScale(geo);
        const dx = (touch.x - sample.clientX) * scale;
        const dy = (touch.y - sample.clientY) * scale;
        touch.moved = true;
        touch.x = sample.clientX;
        touch.y = sample.clientY;
        return [
          {
            type: "wheel",
            ...normalizedPoint(sample.clientX, sample.clientY, geo),
            dx,
            dy,
          },
        ];
      }
      if (sample.pointerType === "touch") return [];
      if (now - lastMove < MOVE_THROTTLE_MS) return [];
      lastMove = now;
      return [
        {
          type: "mouse",
          action: "move",
          buttons: (sample.buttons & 1) as 0 | 1,
          ...normalizedPoint(sample.clientX, sample.clientY, geo),
        },
      ];
    },

    up(sample, geo) {
      const point = normalizedPoint(sample.clientX, sample.clientY, geo);
      if (sample.pointerType === "touch") {
        const tap = touch !== null && !touch.moved;
        touch = null;
        // A scroll must not raise the phone keyboard.
        if (!tap) return { events: [], focusKeyboard: false };
        return {
          events: [{ type: "mouse", action: "click", clickCount: 1, ...point }],
          focusKeyboard: true,
        };
      }
      const events: BrowserLiveViewInput[] =
        sample.button === 0
          ? [{ type: "mouse", action: "up", clickCount: press.count, ...point }]
          : [];
      return { events, focusKeyboard: true };
    },

    cancel() {
      touch = null;
    },
  };
}
