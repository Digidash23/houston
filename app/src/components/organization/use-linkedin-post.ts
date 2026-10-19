import {
  type LinkedInRefusalAction,
  linkedInRefusalAction,
} from "@houston/sdk/linkedin/policy";
import { type Dispatch, type RefObject, useLayoutEffect, useRef } from "react";
import {
  useLinkedInActions,
  useLinkedInConnection,
} from "../../hooks/queries/use-linkedin";
import { useSession } from "../../hooks/use-session";
import { logAndReportError } from "../../lib/error-report";
import { showConnectivityErrorToast } from "../../lib/error-toast";
import { SESSION_QUERY_KEY, type Session } from "../../lib/identity";
import { tauriLinkedIn } from "../../lib/linkedin-facade";
import { openExternalUrl } from "../../lib/open-external-url";
import { queryClient } from "../../lib/query-client";
import { useWorkspaceStore } from "../../stores/workspaces";
import { openOwnPost } from "./linkedin-post-open";
import { LinkedInPostRefusedError, refusalLine } from "./linkedin-post-refusal";
import { runLinkedInPost } from "./linkedin-post-run";
import {
  isPostHeld,
  linkedInPostKey,
  useLinkedInPostSlot,
  useLinkedInPosts,
} from "./linkedin-post-store";
import { jpegOf, postableImage } from "./org-chart-share-encode";
import type {
  ShareDialogAction,
  ShareDialogState,
} from "./org-chart-share-state";
import { connectionRead } from "./org-chart-share-step";
import { useLinkedInConnect } from "./use-linkedin-connect";

/** Who is signed in now, read when a post's step lands, not at render. */
const signedIn = () =>
  queryClient.getQueryData<Session | null>(SESSION_QUERY_KEY)?.uid ?? null;

/**
 * Posting from the share dialog: the connection read (polled while a connect
 * is under way), Connect LinkedIn (`useLinkedInConnect`), Post to LinkedIn
 * and Disconnect. A post is claimed and settled in the space's slot
 * (`linkedin-post-store.ts`), which outlives this page; the dialog on screen
 * shows its result, and the opening that made it opens it (`openOwnPost`).
 */
export function useLinkedInPost(input: {
  enabled: boolean;
  state: ShareDialogState;
  dispatch: Dispatch<ShareDialogAction>;
  session: RefObject<number>;
  onPosted: () => void;
}) {
  const { enabled, state, dispatch, session } = input;
  // One post out per person and space, held outside the page that started it.
  const uid = useSession().data?.uid ?? null;
  const space = useWorkspaceStore((s) => s.current?.id ?? "");
  const postKey = linkedInPostKey(uid, space);
  const slot = useLinkedInPostSlot(postKey);
  const attempt = state.connect;
  const query = useLinkedInConnection(enabled, attempt?.watch ?? null);
  const actions = useLinkedInActions();
  const { connect, connectPhase } = useLinkedInConnect({
    state,
    dispatch,
    session,
    connected: query.data?.connected === true,
    recheck: actions.recheck,
  });
  // Read when a post settles, after the page may have closed or gone.
  const onScreen = useRef<number | null>(null);
  useLayoutEffect(() => {
    onScreen.current = state.open ? state.session : null;
    return () => {
      onScreen.current = null;
    };
  });

  // A post that went up, here or while this page was gone, is said once by
  // the opening on screen; one that may be up, by every opening until the
  // person checked. Before paint, so Post never flashes back.
  const { landed, unconfirmed } = slot;
  const saidUnconfirmed = state.line?.kind === "unconfirmed";
  useLayoutEffect(() => {
    if (!state.open) return;
    if (landed !== null) {
      dispatch({ type: "posted", postUrl: landed });
      useLinkedInPosts.getState().shown(postKey);
    } else if (unconfirmed && !saidUnconfirmed) {
      dispatch({ type: "postUnconfirmed" });
    }
  }, [state.open, landed, unconfirmed, saidUnconfirmed, postKey, dispatch]);

  const refused = (action: LinkedInRefusalAction, retryAfterMs?: number) => {
    if (action === "reconnect") actions.markDisconnected();
    if (action === "fallback") void actions.recheck();
    if (action === "offline")
      showConnectivityErrorToast("linkedin_post", "LinkedIn post: offline");
    dispatch({ type: "postRefused", line: refusalLine(action, retryAfterMs) });
  };

  const post = async (file: File, text: string, altText: string) => {
    const claim = useLinkedInPosts.getState().start(uid, space);
    if (!claim) return;
    const made = session.current;
    dispatch({ type: "posting" });
    const outcome = await runLinkedInPost(claim, {
      signedIn,
      prepare: () =>
        postableImage(file, jpegOf).catch((error: unknown) => {
          logAndReportError("org_chart_share_encode", error);
          throw error;
        }),
      // tauriLinkedIn.postImage reports a failure that is not a refusal.
      send: (image) => tauriLinkedIn.postImage({ image, text, altText }),
    });
    // Signed out or in meanwhile: nothing of it reaches the next person.
    if (!outcome || outcome.kind === "unconfirmed") return;
    if (outcome.kind === "failed") return refused("quiet");
    if (outcome.kind === "posted") {
      input.onPosted();
      return openOwnPost(outcome.postUrl, made, {
        onScreen: () => onScreen.current,
        open: (url) => openExternalUrl(url, { command: "linkedin_view_post" }),
        dispatch,
      });
    }
    const action = linkedInRefusalAction(outcome.code);
    if (action === "report")
      logAndReportError(
        "linkedin_post",
        new LinkedInPostRefusedError(`LinkedIn post refused: ${outcome.code}`),
      );
    refused(action, outcome.retryAfterMs);
  };

  return {
    connection: connectionRead(query),
    connectPhase,
    connect,
    post,
    posting: slot.posting,
    /** A post that may be up waits for the person to check LinkedIn. */
    held: isPostHeld(slot),
    dismissUnconfirmed: () => {
      useLinkedInPosts.getState().dismissUnconfirmed(postKey);
      dispatch({ type: "unconfirmedDismissed" });
    },
    disconnect: () => actions.disconnect.mutate(),
    disconnecting: actions.disconnect.isPending,
  };
}
