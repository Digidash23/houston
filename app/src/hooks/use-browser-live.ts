import type { BrowserLiveConnection } from "@houston/engine-adapter";
import {
  type BrowserLiveViewInput,
  type BrowserLiveViewState,
  isBrowserLiveViewEnded,
} from "@houston-ai/chat";
import { useIsMobile } from "@houston-ai/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserLive } from "../lib/browser-live-facade";
import {
  browserLiveViewState,
  createBrowserLiveFrames,
} from "../lib/browser-live-view-state";
import { logAndReportError } from "../lib/error-report";

export interface BrowserLiveSession {
  state: BrowserLiveViewState;
  url: string;
  title: string;
  expiresAt: number;
  addressRefused: boolean;
  frames: ReturnType<typeof createBrowserLiveFrames>;
  onInput: (events: BrowserLiveViewInput[]) => void;
  onDone: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onPaintError: (error: unknown) => void;
}

/**
 * Owns the SDK's live connection while the view is open: one connection per
 * open, closed on close or unmount (closing stops watching; the hand-off keeps
 * waiting). Connectivity and refusals are the connection's own states, shown
 * in the view and never reported; only `onUnexpected` reaches Sentry.
 */
export function useBrowserLive({
  agentPath,
  conversationId,
  open,
  onFinished,
}: {
  agentPath: string;
  conversationId: string;
  open: boolean;
  /** The person answered (I'm done / Cancel) and the hand-off took it. */
  onFinished: () => void;
}): BrowserLiveSession {
  const layout = useIsMobile() ? "phone" : "desktop";
  const [frames] = useState(createBrowserLiveFrames);
  const [state, setState] = useState<BrowserLiveViewState>("connecting");
  const [page, setPage] = useState({ url: "", title: "" });
  const [expiresAt, setExpiresAt] = useState(0);
  const [addressRefused, setAddressRefused] = useState(false);
  const connection = useRef<BrowserLiveConnection | null>(null);
  // One undecodable frame says what the next ones will: report it once.
  const paintReported = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  useEffect(() => {
    if (!open) return;
    setState("connecting");
    setAddressRefused(false);
    paintReported.current = false;
    try {
      connection.current = browserLive.open(
        agentPath,
        conversationId,
        {
          onFrame: (frame) => frames.push(frame),
          onPage: (next) => {
            setPage(next);
            setAddressRefused(false);
          },
          onStatus: (status) => setExpiresAt(status.expiresAt),
          onConnection: (next) => setState(browserLiveViewState(next)),
          onRefused: () => setAddressRefused(true),
          onUnexpected: (error) => logAndReportError("browser_live", error),
        },
        { layout },
      );
    } catch (error) {
      logAndReportError("browser_live_open", error);
      setState("lost");
    }
    return () => {
      connection.current?.close();
      connection.current = null;
    };
  }, [open, agentPath, conversationId, layout, frames]);

  const onInput = useCallback((events: BrowserLiveViewInput[]) => {
    for (const event of events) {
      if (event.type === "navigate") setAddressRefused(false);
      connection.current?.send(event);
    }
  }, []);

  const finish = useCallback((outcome: "done" | "cancel") => {
    const live = connection.current;
    if (!live) return;
    live
      .finish(outcome)
      .then(() => onFinishedRef.current())
      .catch((error: unknown) =>
        logAndReportError(`browser_live_finish_${outcome}`, error),
      );
  }, []);

  const onDone = useCallback(() => finish("done"), [finish]);
  const onCancel = useCallback(() => finish("cancel"), [finish]);
  const onRetry = useCallback(() => connection.current?.retry(), []);
  const onPaintError = useCallback((error: unknown) => {
    if (paintReported.current) return;
    paintReported.current = true;
    logAndReportError("browser_live_paint", error);
  }, []);

  return {
    state,
    url: page.url,
    title: page.title,
    expiresAt: isBrowserLiveViewEnded(state) ? 0 : expiresAt,
    addressRefused,
    frames,
    onInput,
    onDone,
    onCancel,
    onRetry,
    onPaintError,
  };
}
