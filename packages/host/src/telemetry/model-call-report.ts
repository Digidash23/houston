import type { ModelCallReport } from "@houston/protocol";

const REQUEST_TIMEOUT_MS = 5_000;
/** Turn ids remembered to drop a replayed settle's report (its retry). */
const SEEN_TURNS_CAP = 512;

export interface ModelCallForwarderOptions {
  /** Managed-pod gateway quadruple (same env as usage reporting). */
  report: { url: string; orgSlug: string; agentSlug: string; podToken: string };
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
  error?: (message: string, err: unknown) => void;
}

/**
 * Forward each turn's model-call report to the gateway, which folds it into
 * its per-call latency histograms (engine pods are never scraped, the same
 * reason boot-report.ts pushes). One attempt per report: it is a sample, and
 * a retry that raced a lost response would count the turn twice. The runtime's
 * settle report retries on a dropped socket, so a turn id already forwarded is
 * skipped.
 *
 * Failure posture: a lost sample never touches the turn. A transient failure
 * (network, 5xx) is a warn line. 401/404 is an older gateway without the
 * ingest, or a pod token or slug it refuses: one warn per process says which
 * status, then quiet. Any other refusal means the two sides disagree on the
 * contract, which is our bug, so the first one per process is an error.
 */
export function createModelCallForwarder(
  opts: ModelCallForwarderOptions,
): (report: ModelCallReport) => void {
  const { url, orgSlug, agentSlug, podToken } = opts.report;
  const target = `${url.replace(/\/+$/, "")}/v1/pod/model-calls/${encodeURIComponent(orgSlug)}/${encodeURIComponent(agentSlug)}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const error = opts.error ?? ((m: string, e: unknown) => console.error(m, e));
  const seen = new Set<string>();
  let contractErrorReported = false;
  let refusalWarned = false;
  // Never rejects: every outcome, a failed body cancel included, ends in a
  // status branch or the warn below.
  const send = async (report: ModelCallReport): Promise<void> => {
    try {
      const res = await fetchImpl(target, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${podToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (res.ok) return;
      if (res.status === 401 || res.status === 404) {
        if (refusalWarned) return;
        refusalWarned = true;
        warn(
          `[model-calls] gateway answered ${res.status} (no ingest yet, or the pod token was refused); later refusals stay quiet`,
        );
        return;
      }
      if (res.status >= 500) {
        warn(`[model-calls] gateway answered ${res.status}; sample lost`);
        return;
      }
      if (contractErrorReported) return;
      contractErrorReported = true;
      error(
        "[model-calls] gateway refused the report",
        new Error(`model-call report rejected: status ${res.status}`),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warn(`[model-calls] send failed (${detail}); sample lost`);
    }
  };
  return (report) => {
    if (seen.has(report.turnId)) return;
    seen.add(report.turnId);
    if (seen.size > SEEN_TURNS_CAP) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    void send(report);
  };
}
