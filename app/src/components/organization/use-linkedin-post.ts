import { startLinkedInConnect } from "@houston/sdk/linkedin/connect-flow";
import {
  type LinkedInRefusalAction,
  linkedInRefusalAction,
  startLinkedInConnectWatch,
} from "@houston/sdk/linkedin/policy";
import { type Dispatch, type RefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useLinkedInActions,
  useLinkedInConnection,
} from "../../hooks/queries/use-linkedin";
import { logAndReportError } from "../../lib/error-report";
import { showConnectivityErrorToast } from "../../lib/error-toast";
import { tauriLinkedIn } from "../../lib/linkedin-facade";
import { linkedInConnectPorts } from "./linkedin-connect-ports";
import { jpegOf, postableImage } from "./org-chart-share-encode";
import type { ShareLine } from "./org-chart-share-run";
import type {
  ShareDialogAction,
  ShareDialogState,
} from "./org-chart-share-state";
import type { ConnectionRead } from "./org-chart-share-step";

/** A post the gateway refused for what this client sent: a bug to report. */
export class LinkedInPostRefusedError extends Error {
  override name = "LinkedInPostRefusedError";
}

/** The line a refusal leaves under the button; `null` says nothing. */
const REFUSAL_LINE: Partial<Record<LinkedInRefusalAction, ShareLine>> = {
  reconnect: { kind: "reconnect" },
  wait: { kind: "wait" },
  retry: { kind: "retry" },
};

/**
 * Posting from the share dialog: the connection read (polled while a connect
 * is under way), Connect LinkedIn, Post to LinkedIn and Disconnect. Writes go
 * into the dialog's reducer under the session they started in.
 */
export function useLinkedInPost(input: {
  enabled: boolean;
  state: ShareDialogState;
  dispatch: Dispatch<ShareDialogAction>;
  session: RefObject<number>;
  onPosted: () => void;
}) {
  const { t, i18n } = useTranslation("teams");
  const { enabled, state, dispatch, session } = input;
  const query = useLinkedInConnection(enabled, state.watch);
  const actions = useLinkedInActions();
  const inFlight = useRef(false);

  // The watch ends when the connection lands or its window closes.
  const connected = query.data?.connected === true;
  useEffect(() => {
    if (!state.watch) return;
    if (connected) return dispatch({ type: "watchEnded" });
    const timer = setTimeout(
      () => dispatch({ type: "watchEnded" }),
      Math.max(0, state.watch.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state.watch, connected, dispatch]);

  // Inside the click: a browser only grants LinkedIn's tab there.
  const connect = () => {
    const started = session.current;
    const ports = linkedInConnectPorts(t, i18n.resolvedLanguage);
    dispatch({
      type: "connecting",
      watch: startLinkedInConnectWatch(Date.now()),
    });
    startLinkedInConnect(ports).then(
      (landed) => {
        if (landed.kind === "opened") return;
        dispatch({ type: "watchEnded" });
        if (landed.kind === "blocked")
          dispatch({
            type: "landed",
            session: started,
            line: { kind: "blocked", url: landed.url, channel: null },
          });
      },
      // tauriLinkedIn.connect already reported it (or silenced a deployment
      // with no LinkedIn); the connect is simply over.
      () => {
        dispatch({ type: "watchEnded" });
        void actions.recheck();
      },
    );
  };

  const refused = (started: number, action: LinkedInRefusalAction) => {
    if (action === "reconnect") actions.markDisconnected();
    if (action === "fallback") void actions.recheck();
    if (action === "offline")
      showConnectivityErrorToast("linkedin_post", "LinkedIn post: offline");
    dispatch({
      type: "postRefused",
      session: started,
      line: REFUSAL_LINE[action] ?? null,
    });
  };

  const post = async (file: File, text: string, altText: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const started = session.current;
    dispatch({ type: "posting" });
    try {
      let image: Blob;
      try {
        image = await postableImage(file, jpegOf);
      } catch (error) {
        logAndReportError("org_chart_share_encode", error);
        return refused(started, "quiet");
      }
      const result = await tauriLinkedIn.postImage({ image, text, altText });
      if (result.kind === "posted") {
        input.onPosted();
        return dispatch({
          type: "posted",
          session: started,
          postUrl: result.postUrl,
        });
      }
      const action = linkedInRefusalAction(result.code);
      if (action === "report")
        logAndReportError(
          "linkedin_post",
          new LinkedInPostRefusedError(`LinkedIn post refused: ${result.code}`),
        );
      refused(started, action);
    } catch {
      // tauriLinkedIn.postImage reported the failure; the button comes back.
      refused(started, "quiet");
    } finally {
      inFlight.current = false;
    }
  };

  const connection: ConnectionRead = query.isError
    ? { status: "error" }
    : query.data
      ? { status: "ready", connection: query.data }
      : { status: "pending" };

  return {
    connection,
    connect,
    post,
    disconnect: () => actions.disconnect.mutate(),
    disconnecting: actions.disconnect.isPending,
  };
}
