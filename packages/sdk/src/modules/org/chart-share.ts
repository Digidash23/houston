/**
 * Publishing a picture of the org chart as a public page: the link a LinkedIn
 * post carries, which LinkedIn unfurls into the preview card uploaded with it.
 *
 * Every answer that is not a published page comes back as a typed refusal
 * rather than a throw, because a surface always has somewhere else to send
 * the person (the bare post, the picture on the clipboard) and has to know
 * which refusals are worth reporting (`isExpectedOrgChartShareRefusal`). Only
 * an answer that is neither (a 500, an unreadable 201) throws, and so does an
 * abort through the caller's `signal`, with the signal's reason, the moment it
 * fires: the caller that aborted no longer wants an answer.
 */

import {
  type Capabilities,
  ORG_CHART_SHARE_MAX_BYTES,
  ORG_CHART_SHARE_PREVIEW_MAX_BYTES,
  type OrgChartShareRefusalCode,
  orgChartSharePublishedSchema,
  orgChartShareRefusalOf,
} from "@houston/wire-types";
import { isTransportFailure } from "../../transport-failure";
import { type HttpScope, httpRequest, SdkHttpError } from "../http";
import { orgChartShareTitle } from "./chart-share-title";

export {
  ORG_CHART_SHARE_FALLBACK_TITLE,
  orgChartShareTitle,
} from "./chart-share-title";

export type OrgChartShareResult =
  | {
      kind: "published";
      id: string;
      pageUrl: string;
      imageUrl: string;
      /** Absent when no preview card went up (or the gateway kept none). */
      previewUrl?: string;
      /**
       * The card was refused (by the gateway, or before sending it for being
       * over its cap) and the page went up without it, previewing the square
       * chart. Always a card the client drew wrong, so worth reporting.
       */
      previewRefused?: OrgChartShareRefusalCode;
    }
  | {
      kind: "refused";
      code: OrgChartShareRefusalCode;
      /** The 429's `Retry-After`, when it carried a readable one. */
      retryAfterMs?: number;
    };

/** What `publishOrgChartShare` takes. */
export interface OrgChartShareInput {
  /** The drawn chart, a PNG. */
  image: Blob;
  /**
   * The 1200 x 630 link card drawn around `image`, which the page's preview
   * shows. Without it the preview is the square chart itself.
   */
  preview?: Blob;
  /** The name the chart is drawn under. */
  title: string;
  /**
   * The deployment's own description (`/v1/capabilities`) when the surface
   * has it. Only the hosted gateway (the one deployment that advertises
   * `spaces`) keeps shared pictures, so anywhere else the publish is refused
   * `unavailable` without sending the picture. Unknown (`null`, absent): the
   * route is asked and its own 404 or 503 decides.
   */
  deployment?: Pick<Capabilities, "spaces"> | null;
  /** Aborts the publish; it then rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * The upload `publishOrgChartShare` sends for the facade's input with
 * `preview` as its card (none when absent), or the refusal it earns before
 * any request: a deployment that keeps no shared pictures, or a picture over
 * the gateway's cap. The card's own cap is the caller's to check
 * (`fitsPreviewCap`): an oversized card is dropped, never a refusal.
 */
export function orgChartShareUpload(
  input: OrgChartShareInput,
  preview: Blob | undefined,
): FormData | Extract<OrgChartShareResult, { kind: "refused" }> {
  if (input.deployment && input.deployment.spaces !== true)
    return { kind: "refused", code: "unavailable" };
  const { image } = input;
  if (image.size > ORG_CHART_SHARE_MAX_BYTES)
    return { kind: "refused", code: "too_large" };
  const upload = new FormData();
  upload.append("file", image, "org-chart.png");
  if (preview)
    upload.append(
      "preview",
      preview,
      preview.type === "image/jpeg"
        ? "org-chart-preview.jpg"
        : "org-chart-preview.png",
    );
  upload.append("title", orgChartShareTitle(input.title));
  return upload;
}

/** Whether a card is within the gateway's cap for one. */
export function fitsPreviewCap(preview: Blob): boolean {
  return preview.size <= ORG_CHART_SHARE_PREVIEW_MAX_BYTES;
}

/**
 * A refusal that may be the card's alone (the gateway answers a bad `file`
 * and a bad `preview` with the same codes), so the publish is worth one more
 * try without it.
 */
export function mayBePreviewRefusal(code: OrgChartShareRefusalCode): boolean {
  return (
    code === "too_large" ||
    code === "not_an_image" ||
    code === "invalid_preview_size"
  );
}

/**
 * Publishes a picture of the org chart as a public page anyone with the link
 * can open.
 *
 * Uploads the PNG and its link card with the space's name as its title and
 * answers the page's address, which a post links to so the card shows as its
 * preview. A deployment that keeps no shared pictures, a 429, a lapsed
 * session, a device with no connection, an upload that outlasts its deadline
 * and a picture the gateway will not take all answer `refused` with their
 * code, never a throw. A title with nothing printable left is published under
 * a plain fallback rather than refused.
 * @param upload The facade's input as multipart, built by
 *   `orgChartShareUpload`: `file` (the PNG the share dialog drew, at most
 *   6 MiB), `preview` (the 1200 x 630 card drawn around it, at most 2 MiB,
 *   optional) and `title` (the space's name, or the person's in a personal
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
