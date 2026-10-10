"use client";

import { Button, Spinner } from "@houston-ai/core";
import { type PointerEvent, useEffect, useId, useRef } from "react";
import {
  type BrowserLiveStageGeometry,
  wheelInput,
} from "./browser-live-geometry";
import { useBrowserLiveKeyboard } from "./browser-live-keyboard";
import type { BrowserLiveViewLabels } from "./browser-live-labels";
import { useBrowserLivePaint } from "./browser-live-paint";
import {
  type BrowserLivePointerSample,
  createBrowserLivePointer,
} from "./browser-live-pointer";
import type {
  BrowserLiveFrames,
  BrowserLiveViewInput,
  BrowserLiveViewState,
} from "./browser-live-types";

export interface BrowserLiveStageProps {
  state: BrowserLiveViewState;
  frames: BrowserLiveFrames;
  onInput: (events: BrowserLiveViewInput[]) => void;
  onRetry: () => void;
  onPaintError?: (error: unknown) => void;
  /** Shift+Escape on the page: move focus to the view's own controls. */
  onLeavePage?: () => void;
  labels: BrowserLiveViewLabels;
}

function geometryOf(canvas: HTMLCanvasElement): BrowserLiveStageGeometry {
  const rect = canvas.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    frameWidth: canvas.width,
  };
}

function sampleOf(e: PointerEvent): BrowserLivePointerSample {
  return {
    pointerType: e.pointerType,
    button: e.button,
    buttons: e.buttons,
    clientX: e.clientX,
    clientY: e.clientY,
  };
}

function endedMessage(
  state: BrowserLiveViewState,
  labels: BrowserLiveViewLabels,
): string | null {
  switch (state) {
    case "done":
      return labels.endedDone;
    case "cancelled":
      return labels.endedCancelled;
    case "expired":
      return labels.endedExpired;
    case "none":
      return labels.endedNone;
    case "not_owner":
      return labels.notOwner;
    default:
      return null;
  }
}

/** The page itself: a canvas of the latest frame that forwards input. */
export function BrowserLiveStage({
  state,
  frames,
  onInput,
  onRetry,
  onPaintError,
  onLeavePage,
  labels,
}: BrowserLiveStageProps) {
  const hintId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pointer = useRef(createBrowserLivePointer()).current;
  const painted = useBrowserLivePaint(canvasRef, frames, onPaintError);
  const live = state === "live";
  const send = (event: BrowserLiveViewInput) => onInput([event]);
  useBrowserLiveKeyboard(fieldRef, send, live, onLeavePage);

  // React registers wheel listeners as passive; the page must own the scroll.
  const onInputRef = useRef(onInput);
  useEffect(() => {
    onInputRef.current = onInput;
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onInputRef.current([wheelInput(e, geometryOf(canvas))]);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [live]);

  const handle = (events: BrowserLiveViewInput[]) => {
    if (events.length > 0) onInput(events);
  };
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    handle(pointer.down(sampleOf(e), geometryOf(e.currentTarget), e.timeStamp));
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    handle(pointer.move(sampleOf(e), geometryOf(e.currentTarget), e.timeStamp));
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    const up = pointer.up(sampleOf(e), geometryOf(e.currentTarget));
    handle(up.events);
    // Raises the phone keyboard; on desktop it catches typing.
    if (up.focusKeyboard) fieldRef.current?.focus({ preventScroll: true });
  };

  const ended = endedMessage(state, labels);
  const busy = state === "connecting" || state === "reconnecting";
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden bg-chip-subtle"
      data-browser-live-stage=""
    >
      <div className="absolute inset-0 flex items-start justify-center p-2 md:items-center">
        <canvas
          aria-label={labels.website}
          className={`max-h-full max-w-full touch-none rounded-md bg-background shadow-edge outline-none ${painted ? "" : "invisible"} ${live ? "" : "opacity-60"}`}
          data-testid="browser-live-canvas"
          height={0}
          onContextMenu={(e) => e.preventDefault()}
          onPointerCancel={() => pointer.cancel()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={canvasRef}
          width={0}
        />
      </div>
      {busy ? (
        <div className="absolute inset-x-0 top-4 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-dialog px-3 py-1.5 text-sm text-ink shadow-card">
            <Spinner aria-hidden="true" role="presentation" />
            {state === "connecting" ? labels.connecting : labels.reconnecting}
          </span>
        </div>
      ) : null}
      {state === "lost" || ended ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div
            className="flex max-w-sm flex-col items-center gap-3 rounded-xl bg-dialog p-4 text-center shadow-card"
            role="status"
          >
            <p className="text-sm text-ink">{ended ?? labels.lost}</p>
            {state === "lost" ? (
              <Button className="min-h-11" onClick={onRetry} variant="outline">
                {labels.retry}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <span className="sr-only" id={hintId}>
        {labels.leavePage}
      </span>
      <textarea
        aria-describedby={hintId}
        aria-label={labels.tapToType}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="pointer-events-none absolute bottom-0 left-0 size-px resize-none border-0 p-0 text-base opacity-0"
        data-testid="browser-live-keyboard"
        ref={fieldRef}
        spellCheck={false}
        tabIndex={-1}
      />
    </div>
  );
}
