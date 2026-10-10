"use client";

import { Button } from "@houston-ai/core";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrowserLiveAddress } from "./browser-live-address";
import {
  type BrowserLiveViewLabels,
  DEFAULT_BROWSER_LIVE_VIEW_LABELS,
} from "./browser-live-labels";
import { BrowserLiveStage } from "./browser-live-stage";
import {
  type BrowserLiveFrames,
  type BrowserLiveViewInput,
  type BrowserLiveViewState,
  isBrowserLiveViewEnded,
} from "./browser-live-types";

export interface BrowserLiveViewProps {
  state: BrowserLiveViewState;
  /** What the agent asked the person to do. */
  task: string;
  url: string;
  title: string;
  frames: BrowserLiveFrames;
  /** Epoch ms the hand-off expires at; 0 while unknown. */
  expiresAt: number;
  onInput: (events: BrowserLiveViewInput[]) => void;
  onDone: () => void;
  onCancel: () => void;
  /** Hides the view; the hand-off keeps waiting. */
  onClose: () => void;
  onRetry: () => void;
  /** A frame that could not be drawn: not the person's problem, report it. */
  onPaintError?: (error: unknown) => void;
  /** The last address typed was not a website. */
  addressRefused?: boolean;
  labels?: Partial<BrowserLiveViewLabels>;
}

const TICK_MS = 15_000;

function useMinutesLeft(expiresAt: number, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || expiresAt <= 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [expiresAt, running]);
  if (!running || expiresAt <= 0) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

const PILL = "min-h-11 flex-1 md:min-h-9 md:flex-none";

/**
 * The body of the live browser: the person drives the agent's own browser page
 * (sign in, a code, a captcha) and hands it back. Phone first: one column of
 * header, address bar, page, and the two answers at the bottom where a thumb
 * reaches them. The frame around it (dialog or sheet) belongs to the caller.
 */
export function BrowserLiveView({
  state,
  task,
  url,
  title,
  frames,
  expiresAt,
  onInput,
  onDone,
  onCancel,
  onClose,
  onRetry,
  onPaintError,
  addressRefused = false,
  labels: labelOverrides,
}: BrowserLiveViewProps) {
  const labels = { ...DEFAULT_BROWSER_LIVE_VIEW_LABELS, ...labelOverrides };
  const ended = isBrowserLiveViewEnded(state);
  const live = state === "live";
  const minutes = useMinutesLeft(expiresAt, !ended);
  const send = (event: BrowserLiveViewInput) => onInput([event]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const leavePage = () =>
    toolbarRef.current
      ?.querySelector<HTMLElement>("button:enabled, input:enabled")
      ?.focus();

  return (
    <div className="flex h-full min-h-0 flex-col bg-dialog">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-balance text-ink">
            {task}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{labels.privacy}</p>
          {minutes !== null ? (
            <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
              {labels.timeLeft(minutes)}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={labels.close}
          className="size-11 md:size-9"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-5" />
        </Button>
      </header>
      <div
        className="flex items-start gap-2 border-b border-line px-3 py-2"
        ref={toolbarRef}
      >
        <Button
          className="h-10 shrink-0"
          disabled={!live}
          onClick={() => send({ type: "back" })}
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className="sr-only md:not-sr-only">{labels.back}</span>
        </Button>
        <BrowserLiveAddress
          disabled={!live}
          label={labels.address}
          onNavigate={(target) => send({ type: "navigate", url: target })}
          refused={addressRefused}
          refusedLabel={labels.addressRefused}
          url={url}
        />
      </div>
      <BrowserLiveStage
        frames={frames}
        labels={{ ...labels, website: title || labels.website }}
        onInput={onInput}
        onLeavePage={leavePage}
        onPaintError={onPaintError}
        onRetry={onRetry}
        state={state}
      />
      <footer className="border-t border-line pb-safe md:pb-0">
        <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
          {live ? (
            <p className="text-xs text-ink-muted md:flex-1">
              {labels.tapToType}
            </p>
          ) : null}
          <div className="flex gap-2 md:ml-auto">
            {ended ? (
              <Button className={PILL} onClick={onClose} variant="outline">
                {labels.close}
              </Button>
            ) : (
              <>
                <Button className={PILL} onClick={onCancel} variant="outline">
                  {labels.cancel}
                </Button>
                <Button
                  className={PILL}
                  disabled={state === "connecting"}
                  onClick={onDone}
                >
                  {labels.finish}
                </Button>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
