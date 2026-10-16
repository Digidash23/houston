import { startLinkedInConnect } from "@houston/sdk/linkedin/connect-flow";
import {
  type LinkedInRefusalAction,
  linkedInPostLink,
  linkedInRefusalAction,
  startLinkedInConnectWatch,
} from "@houston/sdk/linkedin/policy";
import {
  type Dispatch,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  useLinkedInActions,
  useLinkedInConnection,
} from "../../hooks/queries/use-linkedin";
import { logAndReportError } from "../../lib/error-report";
import { showConnectivityErrorToast } from "../../lib/error-toast";
import { tauriLinkedIn } from "../../lib/linkedin-facade";
import { useWorkspaceStore } from "../../stores/workspaces";
import { linkedInConnectPorts } from "./linkedin-connect-ports";
import { useLinkedInPostSlot, useLinkedInPosts } from "./linkedin-post-store";
import { jpegOf, postableImage } from "./org-chart-share-encode";
import { createLinkedInGate } from "./org-chart-share-gate";
import type { ShareLine } from "./org-chart-share-run";
import type {
  ShareDialogAction,
  ShareDialogState,
} from "./org-chart-share-state";
import { type ConnectPhase, connectionRead } from "./org-chart-share-step";

/** A post the gateway refused for what this client sent: a bug to report. */
export class LinkedInPostRefusedError extends Error {
  override name = "LinkedInPostRefusedError";
}

/** The line a refusal leaves under the button; `null` says nothing. */
function refusalLine(
  action: LinkedInRefusalAction,
  retryAfterMs: number | undefined,
): ShareLine | null {
  if (action === "reconnect") return { kind: "reconnect" };
  if (action === "retry") return { kind: "retry" };
  if (action !== "wait") return null;
  return retryAfterMs === undefined
    ? { kind: "wait" }
    : { kind: "wait", retryAfterMs };
}

/**
 * Posting from the share dialog: the connection read (polled while a connect
 * is under way), Connect LinkedIn, Post to LinkedIn and Disconnect. A connect
 * writes only into the opening and attempt it started in. A post is claimed
 * and settled in the space's slot (`linkedin-post-store.ts`), which outlives
 * this page; the dialog on screen shows its result.
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
  // One post out per space, held outside the page that started it.
  const postKey = useWorkspaceStore((s) => s.current?.id ?? "");
  const slot = useLinkedInPostSlot(postKey);
  const attempt = state.connect;
  const query = useLinkedInConnection(enabled, attempt?.watch ?? null);
  const actions = useLinkedInActions();
  const attempts = useRef(0);
  // A double click minted two states, and the gateway keeps only the last:
  // the first tab then failed. Checked before the click claims a tab.
  const [gate] = useState(() => createLinkedInGate(() => performance.now()));

  // A post that went up, here or while this page was gone, is said once by
  // the opening on screen; before paint, so Post never flashes back.
  const landed = slot.landed;
  useLayoutEffect(() => {
    if (!state.open || landed === null) return;
    dispatch({ type: "posted", postUrl: landed });
    useLinkedInPosts.getState().shown(postKey);
  }, [state.open, landed, postKey, dispatch]);

  // The attempt ends when the connection lands or its window closes.
  const connected = query.data?.connected === true;
  const opening = state.session;
  useEffect(() => {
    if (!attempt) return;
    const tag = { session: opening, attempt: attempt.id };
    if (connected) return dispatch({ type: "connectEnded", ...tag });
    const timer = setTimeout(
      () => dispatch({ type: "connectEnded", ...tag }),
      Math.max(0, attempt.watch.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [attempt, opening, connected, dispatch]);

  // Inside the click: a browser only grants LinkedIn's tab there. Starting
  // over is the same click: a new attempt, whose state replaces the old one
  // at the gateway, and the old attempt's results are dropped.
  const connect = () => {
    gate(() => {
      const tag = { session: session.current, attempt: ++attempts.current };
      const ports = linkedInConnectPorts(t, i18n.resolvedLanguage);
      dispatch({
        type: "connecting",
        ...tag,
        watch: startLinkedInConnectWatch(Date.now()),
      });
      return startLinkedInConnect(ports).then(
        (landed) => {
          if (landed.kind === "opened")
            return dispatch({ type: "connectOpened", ...tag });
          dispatch({
            type: "connectEnded",
            ...tag,
            line:
              landed.kind === "blocked"
                ? { kind: "blocked", url: landed.url, channel: null }
                : undefined,
          });
        },
        // tauriLinkedIn.connect already reported it (or silenced a deployment
        // with no LinkedIn); the connect is simply over.
        () => {
          dispatch({ type: "connectEnded", ...tag });
          void actions.recheck();
        },
      );
    });
  };

  const refused = (action: LinkedInRefusalAction, retryAfterMs?: number) => {
    if (action === "reconnect") actions.markDisconnected();
    if (action === "fallback") void actions.recheck();
    if (action === "offline")
      showConnectivityErrorToast("linkedin_post", "LinkedIn post: offline");
    dispatch({ type: "postRefused", line: refusalLine(action, retryAfterMs) });
  };

  const post = async (file: File, text: string, altText: string) => {
    const posts = useLinkedInPosts.getState();
    if (!posts.start(postKey)) return;
    dispatch({ type: "posting" });
    try {
      let image: Blob;
      try {
        image = await postableImage(file, jpegOf);
      } catch (error) {
        logAndReportError("org_chart_share_encode", error);
        return refused("quiet");
      }
      const result = await tauriLinkedIn.postImage({ image, text, altText });
      if (result.kind === "posted") {
        input.onPosted();
        return posts.posted(postKey, linkedInPostLink(result.postUrl));
      }
      const action = linkedInRefusalAction(result.code);
      if (action === "report")
        logAndReportError(
          "linkedin_post",
          new LinkedInPostRefusedError(`LinkedIn post refused: ${result.code}`),
        );
      refused(action, result.retryAfterMs);
    } catch {
      // tauriLinkedIn.postImage reported the failure; the button comes back.
      refused("quiet");
    } finally {
      posts.ended(postKey);
    }
  };

  const connectPhase: ConnectPhase = !attempt
    ? "idle"
    : attempt.minting
      ? "minting"
      : "waiting";

  return {
    connection: connectionRead(query),
    connectPhase,
    connect,
    post,
    posting: slot.posting,
    disconnect: () => actions.disconnect.mutate(),
    disconnecting: actions.disconnect.isPending,
  };
}
