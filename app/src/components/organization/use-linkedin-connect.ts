import { startLinkedInConnect } from "@houston/sdk/linkedin/connect-flow";
import { startLinkedInConnectWatch } from "@houston/sdk/linkedin/policy";
import {
  type Dispatch,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { linkedInConnectPorts } from "./linkedin-connect-ports";
import { createLinkedInGate } from "./org-chart-share-gate";
import type {
  ShareDialogAction,
  ShareDialogState,
} from "./org-chart-share-state";
import type { ConnectPhase } from "./org-chart-share-step";

/**
 * Connect LinkedIn from the share dialog. A connect writes only into the
 * opening and attempt it started in, and ends when the connection lands or
 * its window closes.
 */
export function useLinkedInConnect(input: {
  state: ShareDialogState;
  dispatch: Dispatch<ShareDialogAction>;
  session: RefObject<number>;
  /** The connection read says LinkedIn is connected. */
  connected: boolean;
  recheck: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation("teams");
  const { state, dispatch, session, connected, recheck } = input;
  const attempt = state.connect;
  const attempts = useRef(0);
  // A double click minted two states, and the gateway keeps only the last:
  // the first tab then failed. Checked before the click claims a tab.
  const [gate] = useState(() => createLinkedInGate(() => performance.now()));

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
          void recheck();
        },
      );
    });
  };

  const connectPhase: ConnectPhase = !attempt
    ? "idle"
    : attempt.minting
      ? "minting"
      : "waiting";

  return { connect, connectPhase };
}
