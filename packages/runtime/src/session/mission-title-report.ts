import { fetchWithRetry } from "@houston/runtime-client/object-sync";
import { config } from "../config";
import { type ActingContext, runWithActingContext } from "./acting-context";
import {
  generateMissionTitle,
  type MissionTitleRequest,
  type MissionTitleRunner,
} from "./mission-title";
import { titleWithTurnModel } from "./summarize";

const REQUEST_TIMEOUT_MS = 5_000;
/** Gateway/proxy answers meaning "the host is not there right now". */
const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

/** Injectable seams for tests. */
export interface MissionTitleReportOptions {
  run?: MissionTitleRunner;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
  timeoutMs?: number;
}

/**
 * The standing runtime's (desktop, GKE pod) half of the after-turn title: runs
 * once the turn's reply is published and the workdir lock is released, titles
 * on the turn's own model under the turn's acting identity, and hands the result
 * to the host (`POST /sandbox/missions/title`), which writes the card only while
 * it still shows `fallback` and fires ActivityChanged. Never rejects.
 */
export async function titleMissionAfterTurn(
  conversationId: string,
  request: MissionTitleRequest,
  model: { provider: string; id: string },
  acting: ActingContext | undefined,
  opts: MissionTitleReportOptions = {},
): Promise<void> {
  const run =
    opts.run ??
    ((excerpt: string, signal: AbortSignal) =>
      runWithActingContext(acting, () =>
        titleWithTurnModel(excerpt, model, signal),
      ));
  const title = await generateMissionTitle(
    conversationId,
    request,
    run,
    opts.timeoutMs,
  );
  if (!title) return;
  if (!config.controlPlaneUrl || !config.sandboxToken) {
    console.warn(
      `[mission-title] no host to write the title to for ${conversationId}`,
    );
    return;
  }
  const base = config.controlPlaneUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchWithRetry(
      (url, init) =>
        fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      `${base}/sandbox/missions/title`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.sandboxToken}`,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          title,
          fallback: request.fallback,
        }),
      },
      opts.retryDelaysMs ? { delaysMs: opts.retryDelaysMs } : {},
    );
    await response.body?.cancel();
    // `{ok:false}` on a 200 is the expected "card renamed / gone" answer. A
    // 502/503/504 that outlived the retries is the host being unreachable
    // (connectivity, a warning); any other non-2xx is the host refusing a
    // write it should have taken — a Houston fault that must reach Sentry.
    if (UNREACHABLE_STATUSES.has(response.status))
      console.warn(
        `[mission-title] host unreachable for ${conversationId} (HTTP ${response.status}); keeping the fallback`,
      );
    else if (!response.ok)
      console.error(
        `[mission-title] host refused the title for ${conversationId}: HTTP ${response.status}`,
      );
  } catch (err) {
    // The pod↔host socket dropping is connectivity, not a Houston fault: the
    // card keeps its fallback title, which is a complete answer on its own.
    console.warn(
      `[mission-title] title write failed for ${conversationId}; keeping the fallback:`,
      err,
    );
  }
}
