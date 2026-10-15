/**
 * Publishing a picture of the org chart as a public page: the link a LinkedIn
 * post carries, which LinkedIn unfurls into a preview of the picture.
 *
 * Every answer the route can give that is not a published page comes back as
 * a typed refusal rather than a throw, because a surface always has somewhere
 * else to send the person (the bare post, the picture on the clipboard) and
 * has to know which refusals are worth reporting
 * (`isExpectedOrgChartShareRefusal`). Only an answer that is neither (a 500,
 * an unreadable 201) throws, and so does an abort through `signal` (the
 * fetch's own `AbortError`): the caller that aborted no longer wants an answer.
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

/** What `publishOrgChartShare` takes: the drawn PNG and the name it is drawn under. */
export interface OrgChartShareInput {
  image: Blob;
  title: string;
}

/**
 * The page's title when the given one has nothing printable left. Plain
 * English like the page that shows it (the Agent Store site is English-only).
 */
export const ORG_CHART_SHARE_FALLBACK_TITLE = "Our AI team";

/**
 * Control (Cc) and format (Cf) characters, which the gateway refuses in a
 * title, except the zero-width joiner it keeps: the glue inside emoji such as
 * a family or a profession with a skin tone.
 */
const UNPRINTABLE = /(?!\u200D)[\p{Cc}\p{Cf}]/gu;

/**
 * The title as the gateway takes it: control and format characters dropped
 * (bidi overrides, zero-width spaces), trimmed, and cut at
 * {@link ORG_CHART_SHARE_TITLE_MAX} code points so a cut never splits an
 * emoji. A title with nothing visible left becomes {@link ORG_CHART_SHARE_FALLBACK_TITLE}.
 */
export function orgChartShareTitle(title: string): string {
  const cut = Array.from(title.replace(UNPRINTABLE, "").trim())
    .slice(0, ORG_CHART_SHARE_TITLE_MAX)
    .join("")
    .trim();
  return /[^\s\u200D]/u.test(cut) ? cut : ORG_CHART_SHARE_FALLBACK_TITLE;
}

/**
 * The upload `publishOrgChartShare` sends for the facade's `{ image, title }`,
 * or the refusal a picture over the gateway's cap earns before any request.
 */
export function orgChartShareUpload(
  input: OrgChartShareInput,
): FormData | OrgChartShareResult {
  if (input.image.size > ORG_CHART_SHARE_MAX_BYTES)
    return { kind: "refused", code: "too_large" };
  const upload = new FormData();
  upload.append("file", input.image, "org-chart.png");
  upload.append("title", orgChartShareTitle(input.title));
  return upload;
}

/**
 * Publishes a picture of the org chart as a public page anyone with the link
 * can open.
 *
 * Uploads the PNG with the space's name as its title and answers the page's
 * address, which a post links to so the picture shows as its preview. A
 * deployment that keeps no shared pictures, a 429, a lapsed session, a device
 * with no connection and a picture the gateway will not take all answer
 * `refused` with their code, never a throw. A title with nothing printable
 * left is published under a plain fallback rather than refused.
 * @param upload The facade's `{ image, title }` as multipart, built by
 *   `orgChartShareUpload`: `file` (the PNG the share dialog drew, at most
 *   6 MiB) and `title` (the space's name, or the person's in a personal
 *   space). The route reads its body off this parameter, so the facade
 *   builds it.
 * @assistant group:org hidden: the share dialog draws the picture on the person's device; the assistant has no picture of the chart to send.
 * @assistant unschematized: the picture is binary multipart, which no JSON schema describes.
 */
export async function publishOrgChartShare(
  scope: HttpScope,
  upload: FormData,
  signal?: AbortSignal,
): Promise<OrgChartShareResult> {
  let res: Response;
  try {
    res = await httpRequest(scope, "/v1/org-chart-shares", {
      method: "POST",
      body: upload,
      signal,
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
