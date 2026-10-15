/**
 * Where the live frame sits on screen, and screen positions as frame
 * positions. Pure; shared by the pointer tracker and the stage's wheel path.
 */

import type { BrowserLiveViewInput } from "./browser-live-types";

export interface BrowserLiveWheelSample {
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines (Firefox), 2 = pages. */
  deltaMode: number;
}

/** Where the frame is painted on screen, plus its own pixel width. */
export interface BrowserLiveStageGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  frameWidth: number;
}

const LINE_PX = 16;
const PAGE_PX = 800;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The sample's position as 0..1 of the painted frame. */
export function normalizedPoint(
  clientX: number,
  clientY: number,
  geo: BrowserLiveStageGeometry,
): { x: number; y: number } {
  if (geo.width <= 0 || geo.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - geo.left) / geo.width),
    y: clamp01((clientY - geo.top) / geo.height),
  };
}

/** CSS pixels on screen to page pixels of the frame. */
export function pageScale(geo: BrowserLiveStageGeometry): number {
  return geo.width > 0 && geo.frameWidth > 0 ? geo.frameWidth / geo.width : 1;
}

export function wheelInput(
  sample: BrowserLiveWheelSample,
  geo: BrowserLiveStageGeometry,
): BrowserLiveViewInput {
  const k =
    sample.deltaMode === 1 ? LINE_PX : sample.deltaMode === 2 ? PAGE_PX : 1;
  return {
    type: "wheel",
    ...normalizedPoint(sample.clientX, sample.clientY, geo),
    dx: sample.deltaX * k,
    dy: sample.deltaY * k,
  };
}
