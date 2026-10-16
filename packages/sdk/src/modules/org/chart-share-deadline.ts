import type { HttpScope } from "../http";
import {
  type OrgChartShareInput,
  type OrgChartShareResult,
  orgChartShareUpload,
  publishOrgChartShare,
} from "./chart-share";

/**
 * How long a publish may run before it is given up on. A surface holds its
 * Share button on the upload, so one that never answers must still end: past
 * this the request is aborted and the publish answers `timed_out`.
 */
export const ORG_CHART_SHARE_DEADLINE_MS = 30_000;

/**
 * The facade's `publishOrgChartShare`: the deployment gate and the size caps
 * (`orgChartShareUpload`), then the request under
 * {@link ORG_CHART_SHARE_DEADLINE_MS} and the caller's `signal`. The caller's
 * abort rejects with its reason as soon as it fires, without waiting for the
 * transport to notice (a token refresh in flight need not read the signal).
 */
export function publishChartShare(
  scope: HttpScope,
  input: OrgChartShareInput,
): Promise<OrgChartShareResult> {
  const { signal } = input;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const upload = orgChartShareUpload(input);
  if (!(upload instanceof FormData)) return Promise.resolve(upload);
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
    publishOrgChartShare(scope, upload, request.signal).then(
      (result) => settle(() => resolve(result)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
