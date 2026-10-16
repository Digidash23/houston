import type { HttpScope } from "../http";
import {
  fitsPreviewCap,
  mayBePreviewRefusal,
  type OrgChartShareInput,
  type OrgChartShareResult,
  orgChartShareUpload,
  publishOrgChartShare,
} from "./chart-share";

/**
 * How long a publish may run before it is given up on, its retry without the
 * card included. A surface holds its Share button on the upload, so one that
 * never answers must still end: past this the request is aborted and the
 * publish answers `timed_out`. Sized for the 8 MiB upload on a slow phone
 * connection.
 */
export const ORG_CHART_SHARE_DEADLINE_MS = 60_000;

/**
 * The upload, and once more without the card when the gateway refused it
 * with a code the card alone may have earned: the card is a nicety, the page
 * is the share. A card over the gateway's cap is never sent. When the retry
 * is refused too the card was not the problem, and the retry's refusal is
 * the answer.
 */
async function publishWithCardFallback(
  scope: HttpScope,
  input: OrgChartShareInput,
  signal: AbortSignal,
): Promise<OrgChartShareResult> {
  const card = input.preview;
  const sent = card && fitsPreviewCap(card) ? card : undefined;
  const upload = orgChartShareUpload(input, sent);
  if (!(upload instanceof FormData)) return upload;
  const first = await publishOrgChartShare(scope, upload, signal);
  if (card && !sent && first.kind === "published")
    return { ...first, previewRefused: "too_large" };
  if (!sent || first.kind !== "refused" || !mayBePreviewRefusal(first.code))
    return first;
  if (signal.aborted) throw signal.reason;
  const bare = orgChartShareUpload(input, undefined);
  if (!(bare instanceof FormData)) return bare;
  const second = await publishOrgChartShare(scope, bare, signal);
  return second.kind === "published"
    ? { ...second, previewRefused: first.code }
    : second;
}

/**
 * The facade's `publishOrgChartShare`: the deployment gate and the size caps
 * (`orgChartShareUpload`), then the request (and its retry without the card)
 * under {@link ORG_CHART_SHARE_DEADLINE_MS} and the caller's `signal`. The
 * caller's abort rejects with its reason as soon as it fires, without waiting
 * for the transport to notice (a token refresh in flight need not read the
 * signal).
 */
export function publishChartShare(
  scope: HttpScope,
  input: OrgChartShareInput,
): Promise<OrgChartShareResult> {
  const { signal } = input;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const { clock } = scope.ports;
  const request = new AbortController();
  return new Promise<OrgChartShareResult>((resolve, reject) => {
    let open = true;
    const settle = (finish: () => void) => {
      if (!open) return;
      open = false;
      clock.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      finish();
    };
    const onAbort = () =>
      settle(() => {
        request.abort(signal?.reason);
        reject(signal?.reason);
      });
    const timer = clock.setTimeout(
      () =>
        settle(() => {
          request.abort(
            new DOMException("org chart share timed out", "TimeoutError"),
          );
          resolve({ kind: "refused", code: "timed_out" });
        }),
      ORG_CHART_SHARE_DEADLINE_MS,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    publishWithCardFallback(scope, input, request.signal).then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
