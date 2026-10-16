import type { HttpScope } from "../http";
import {
  fitsPreviewCap,
  mayBePreviewRefusal,
  type OrgChartShareDetours,
  type OrgChartShareInput,
  type OrgChartShareResult,
  orgChartShareUpload,
  publishOrgChartShare,
} from "./chart-share";
import {
  ORG_CHART_SHARE_FALLBACK_TITLE,
  orgChartShareTitle,
} from "./chart-share-title";

/**
 * How long a publish may run before it is given up on, its retries
 * included. A surface holds its Share button on the upload, so one that
 * never answers must still end: past this the request is aborted and the
 * publish answers `timed_out`. Sized for the 8 MiB upload on a slow phone
 * connection.
 */
export const ORG_CHART_SHARE_DEADLINE_MS = 60_000;

/**
 * The upload, and once more for each thing the client may have got wrong:
 *  - without the card, when the gateway refused it with a code the card
 *    alone may have earned (the card is a nicety, the page is the share). A
 *    card over the gateway's cap is never sent.
 *  - under `ORG_CHART_SHARE_FALLBACK_TITLE`, when the gateway refused the
 *    cleaned title (`invalid_title`): the title rule is ported, so this is
 *    a gap in the port, and the page still goes up.
 * Each kind of retry happens once, so a publish makes at most three
 * attempts. Every attempt spends one of the person's gateway upload slots
 * (30 an hour, C25): a refused card costs two. What each retry got past is
 * written into `detours` as it happens, so an answer that comes later (a
 * refusal, the deadline) still carries it.
 */
async function publishWithRetries(
  scope: HttpScope,
  input: OrgChartShareInput,
  signal: AbortSignal,
  detours: OrgChartShareDetours,
): Promise<OrgChartShareResult> {
  const card = input.preview;
  let preview = card && fitsPreviewCap(card) ? card : undefined;
  if (card && !preview) detours.previewRefused = "too_large";
  let title = orgChartShareTitle(input.title);
  for (;;) {
    const upload = orgChartShareUpload(input, preview, title);
    if (!(upload instanceof FormData)) return upload;
    const answer = await publishOrgChartShare(scope, upload, signal);
    if (answer.kind !== "refused") return answer;
    if (preview && mayBePreviewRefusal(answer.code)) {
      detours.previewRefused ??= answer.code;
      preview = undefined;
    } else if (
      answer.code === "invalid_title" &&
      title !== ORG_CHART_SHARE_FALLBACK_TITLE
    ) {
      detours.titleRefused = true;
      title = ORG_CHART_SHARE_FALLBACK_TITLE;
    } else {
      return answer;
    }
    if (signal.aborted) throw signal.reason;
  }
}

/**
 * `result` with what the publish got past, unless its own refusal is that
 * same one: then the retry showed the card or the title was not the
 * problem, and the refusal is the whole answer.
 */
function withDetours(
  result: OrgChartShareResult,
  detours: OrgChartShareDetours,
): OrgChartShareResult {
  const code = result.kind === "refused" ? result.code : null;
  const out = { ...result };
  if (detours.previewRefused && detours.previewRefused !== code)
    out.previewRefused = detours.previewRefused;
  if (detours.titleRefused && code !== "invalid_title") out.titleRefused = true;
  return out;
}

/**
 * The facade's `publishOrgChartShare`: the deployment gate and the size caps
 * (`orgChartShareUpload`), then the request (and its retries) under
 * {@link ORG_CHART_SHARE_DEADLINE_MS} and the caller's `signal`. The
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
  const detours: OrgChartShareDetours = {};
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
          resolve(withDetours({ kind: "refused", code: "timed_out" }, detours));
        }),
      ORG_CHART_SHARE_DEADLINE_MS,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    publishWithRetries(scope, input, request.signal, detours).then(
      (result) => settle(() => resolve(withDetours(result, detours))),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
