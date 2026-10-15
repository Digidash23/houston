/**
 * Publishing a picture of the org chart as a public page: the link a LinkedIn
 * post carries, which LinkedIn unfurls into a preview of the picture.
 *
 * Every answer the route can give that is not a published page comes back as
 * a typed refusal rather than a throw, because a surface always has somewhere
 * else to send the person (the bare post, the picture on the clipboard) and
 * has to know which refusals are worth reporting
 * (`isExpectedOrgChartShareRefusal`). Only an answer that is neither (a 500,
 * an unreadable 201) throws.
 */

import {
  ORG_CHART_SHARE_MAX_BYTES,
  ORG_CHART_SHARE_TITLE_MAX,
  type OrgChartShareRefusalCode,
  orgChartSharePublishedSchema,
  orgChartShareRefusalOf,
} from "@houston/wire-types";
import { isTransportFailure } from "../../transport-failure";
import { type HttpScope, httpRequest, SdkHttpError } from "../http";

export type OrgChartShareResult =
  | { kind: "published"; id: string; pageUrl: string; imageUrl: string }
  | {
      kind: "refused";
      code: OrgChartShareRefusalCode;
      /** The 429's `Retry-After`, when it carried a readable one. */
      retryAfterMs?: number;
    };

/**
 * The title as the gateway takes it: trimmed, and cut at
 * {@link ORG_CHART_SHARE_TITLE_MAX} characters (code points, so a cut never
 * splits an emoji). Empty when nothing is left.
 */
export function orgChartShareTitle(title: string): string {
  return Array.from(title.trim())
    .slice(0, ORG_CHART_SHARE_TITLE_MAX)
    .join("")
    .trim();
}

/**
 * The upload `publishOrgChartShare` sends, or the refusal an input earns
 * before any request: a title with nothing left once trimmed, or a picture
 * over the gateway's cap.
 */
export function orgChartShareUpload(
  image: Blob,
  title: string,
): FormData | OrgChartShareResult {
  const name = orgChartShareTitle(title);
  if (!name) return { kind: "refused", code: "invalid_title" };
  if (image.size > ORG_CHART_SHARE_MAX_BYTES)
    return { kind: "refused", code: "too_large" };
  const form = new FormData();
  form.append("file", image, "org-chart.png");
  form.append("title", name);
  return form;
}

/**
 * Publishes a picture of the org chart as a public page anyone with the link
 * can open.
 *
 * Uploads the PNG with the space's name as its title and answers the page's
 * address, which a post links to so the picture shows as its preview. A
 * deployment that keeps no shared pictures, a 429, a lapsed session, a device
 * with no connection and a picture or title the gateway will not take all
 * answer `refused` with their code, never a throw.
 * @param upload The multipart `file` (the PNG the share dialog drew) and
 *   `title`, as orgChartShareUpload builds it.
 * @assistant group:org hidden: the share dialog draws the picture on the person's device; the assistant has no picture of the chart to send.
 * @assistant unschematized: the picture is binary multipart, which no JSON schema describes.
 */
export async function publishOrgChartShare(
  scope: HttpScope,
  upload: FormData,
): Promise<OrgChartShareResult> {
  let res: Response;
  try {
    res = await httpRequest(scope, "/v1/org-chart-shares", {
      method: "POST",
      body: upload,
    });
  } catch (err) {
    if (isTransportFailure(err)) return { kind: "refused", code: "offline" };
    if (!(err instanceof SdkHttpError)) throw err;
    const code = orgChartShareRefusalOf(err.status, err.message);
    if (!code) throw err;
    return err.retryAfterMs === undefined
      ? { kind: "refused", code }
      : { kind: "refused", code, retryAfterMs: err.retryAfterMs };
  }
  const parsed = orgChartSharePublishedSchema.safeParse(await res.json());
  if (!parsed.success)
    throw new Error(
      `org chart share answered ${res.status} with an unreadable body`,
    );
  return { kind: "published", ...parsed.data };
}
