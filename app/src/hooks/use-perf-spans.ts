import { subscribeFirstResponses } from "@houston/engine-adapter";
import { useEffect, useRef } from "react";
import { analytics } from "../lib/analytics";
import { bakedUrl } from "../lib/baked-url";
import { osLaunchT0Ms } from "../lib/os-bridge";
import {
  perfSpanEventProps,
  perfSpanNeedsMemberships,
  perfSpanOrgSlug,
} from "../lib/perf-span-mirror";
import {
  type PerfSpanObservation,
  type PerfSpanTransport,
  perfSpans,
} from "../lib/perf-spans";
import { currentPlatformOs } from "../lib/platform";
import { useWorkspaceStore } from "../stores/workspaces";
import { useOrgs } from "./queries/use-spaces";
import { useCapabilities } from "./use-capabilities";
import { useSession } from "./use-session";
import { useSpanOrgSync } from "./use-span-org-sync";

/**
 * Where client perf spans land: the gateway's `/v1/client-metrics` ingest
 * (session-authed; the gateway folds them into Prometheus histograms). Same
 * target in local-sidecar AND gateway-fronted modes — the route is
 * gateway-owned, never proxied to a pod.
 *
 * Baked at build time (`VITE_CLIENT_METRICS_GATEWAY_URL`), never a literal:
 * see {@link bakedUrl}. `undefined` means this build has no ingest, so we
 * install a mirror-only transport instead of posting at a guessed host.
 */
const CLIENT_METRICS_URL = bakedUrl(
  import.meta.env?.VITE_CLIENT_METRICS_GATEWAY_URL as string | undefined,
);

const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/**
 * Wires the perf-span singleton (HOU-1011): upgrades T0 to the Tauri shell's
 * process-start stamp, and installs the transport once a session exists —
 * signed-out installs keep measuring but only mirror to PostHog (the gateway
 * ingest requires a user). Mount once in `<App/>`, like the other one-shot
 * app-level subscribers.
 */
export function usePerfSpans(): void {
  usePerfSpanOrgSlug();
  const { data: session } = useSession();
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.idToken ?? null;

  useEffect(() => {
    void osLaunchT0Ms().then((t0) => {
      if (t0 !== null) perfSpans.setLaunchT0(t0);
    });
    const transport: PerfSpanTransport = {
      mirror(span, ms, tags) {
        analytics.track("perf_span", perfSpanEventProps(span, ms, tags));
      },
    };
    const ingest = CLIENT_METRICS_URL;
    if (ingest) {
      transport.send = async (spans: PerfSpanObservation[]) => {
        const token = tokenRef.current;
        // No session yet → throw so PerfSpans RE-QUEUES the batch (bounded)
        // instead of counting it delivered. The earliest span of a session
        // (app_to_board) routinely beats the async session load — dropping
        // here silently under-counted exactly the journey we care most about.
        // The token-arrival effect below re-flushes the queue.
        if (!token) throw new Error("session not ready");
        const res = await fetch(`${ingest}/v1/client-metrics`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            spans: spans.map((s) => ({
              ...s,
              platform: currentPlatformOs,
              appVersion: APP_VERSION,
            })),
          }),
        });
        // 404 = older gateway without the ingest; treat as delivered.
        if (!res.ok && res.status !== 404)
          throw new Error(`client-metrics rejected: ${res.status}`);
      };
    }
    perfSpans.configure(transport);
    // Every turn the client sends reports its first response (paired to that
    // turn by the SDK), whichever surface sent it.
    const offResponses = subscribeFirstResponses(({ response }) =>
      perfSpans.turnResponded(response),
    );
    const onHide = () => {
      if (document.visibilityState === "hidden") void perfSpans.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      offResponses();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Session arrived after early spans were measured (the common cold-start
  // order): drain the re-queued batches now instead of waiting for the next
  // observation to schedule a flush.
  const token = session?.idToken ?? null;
  useEffect(() => {
    if (token) void perfSpans.flush();
  }, [token]);
}

/**
 * Keeps the spans' org slug on the active space. Only a settled hosted
 * personal space reads the memberships list to name its org, through the
 * `useOrgs` query the sidebar's invite inbox shares, and without focus
 * refetches of its own (the personal org never changes under a session).
 */
function usePerfSpanOrgSlug(): void {
  const { capabilities } = useCapabilities();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const { data: orgs } = useOrgs(
    perfSpanNeedsMemberships(capabilities, workspaceId),
    { refetchOnWindowFocus: false },
  );
  useSpanOrgSync(perfSpanOrgSlug(capabilities, workspaceId, orgs), perfSpans);
}
