import { useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspaces";
import { useCapabilities } from "./use-capabilities";

/**
 * Keeps the space list live while the app is open (C8 spaces): a user who is
 * added to a team must see it appear without relaunching Houston — the
 * member-added email says "pick it from the workspace switcher", so the
 * switcher has to be current by the time they look.
 *
 * Why polling: no server event covers this. The gateway emits nothing when a
 * person joins or leaves a team, or when a team is renamed or deleted, so the
 * only way to learn it is to re-list. A quiet re-list on window focus (the
 * "read the email → switch back to Houston" moment) plus a slow interval
 * covers both the foreground and the left-open cases without any spinner or
 * toast: `refreshWorkspaces` never flips `loading` and its failures are
 * log-only.
 *
 * The re-list is ONE gateway read (`GET /v1/workspaces`) and never reaches an
 * agent, so it cannot keep a pod awake. It used to also read the selected
 * agent's providers, once a minute, which pinned that agent awake for as long
 * as the window stayed open.
 *
 * Gated on `capabilities.spaces` — the deployment says whether spaces exist;
 * single-player hosts never poll.
 */
const SPACES_REFRESH_INTERVAL_MS = 5 * 60_000;

export function useSpacesLiveRefresh(): void {
  const { capabilities } = useCapabilities();
  const spacesOn = capabilities?.spaces === true;
  const refreshWorkspaces = useWorkspaceStore((s) => s.refreshWorkspaces);

  useEffect(() => {
    if (!spacesOn) return;
    const refresh = () => void refreshWorkspaces();
    window.addEventListener("focus", refresh);
    const interval = setInterval(refresh, SPACES_REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
    };
  }, [spacesOn, refreshWorkspaces]);
}
