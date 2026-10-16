import { z } from "zod";

/**
 * A shared org chart picture (`/v1/org-chart-shares`, gateway only).
 *
 * `POST /v1/org-chart-shares` takes multipart `file` (a PNG, at most
 * {@link ORG_CHART_SHARE_MAX_BYTES}), an optional `preview` (the link card
 * drawn around it, exactly {@link ORG_CHART_SHARE_PREVIEW_SIZE}, at most
 * {@link ORG_CHART_SHARE_PREVIEW_MAX_BYTES})
 * and `title` (1 to {@link ORG_CHART_SHARE_TITLE_MAX} code points, trimmed,
 * with no control, format or default-ignorable code point but the
 * zero-width joiner, an emoji presentation selector after a visible
 * character, and the three standard subdivision flags) and answers
 * 201 with {@link OrgChartSharePublished}: the public page a LinkedIn post
 * links to, whose preview image is the card (the chart itself when no card
 * came). The reads are public and only the Agent Store site and link-preview
 * crawlers make them: `GET /v1/org-chart-shares/{id}` (the record),
 * `/image` and `/preview` (the bytes).
 */

export const ORG_CHART_SHARE_MAX_BYTES = 6 * 1024 * 1024;
export const ORG_CHART_SHARE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const ORG_CHART_SHARE_TITLE_MAX = 120;
/** The only size the gateway takes a preview card at. */
export const ORG_CHART_SHARE_PREVIEW_SIZE = {
  width: 1200,
  height: 630,
} as const;

/** 22 base64url characters: 16 random bytes. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;

export const orgChartSharePublishedSchema = z.object({
  id: z.string().regex(SHARE_ID),
  imageUrl: z.url({ protocol: /^https?$/ }),
  /** Absent when the upload carried no preview card. */
  previewUrl: z.url({ protocol: /^https?$/ }).optional(),
  pageUrl: z.url({ protocol: /^https?$/ }),
});
export type OrgChartSharePublished = z.infer<
  typeof orgChartSharePublishedSchema
>;

/**
 * Why a publish did not happen, read off the answer.
 *
 *  - `unavailable`: this deployment keeps no shared pictures (503, or a
 *    gateway or host that does not serve the route at all).
 *  - `rate_limited`: 429; the refusal's `Retry-After` rides beside it.
 *  - `signed_out`: 401; the session lapsed and the auth-expiry signal fired.
 *  - `account_deleted`: 410 `account_deleted`; the account is being deleted.
 *  - `offline`: no answer reached the device.
 *  - `timed_out`: an answer did not come back in time and the upload was
 *    given up on (a slow connection, not a refusal the gateway made).
 *  - `too_large` (413), `not_an_image` (415, or a 400 `invalid_image` /
 *    `no_file`), `invalid_title` (a 400 `invalid_title`),
 *    `invalid_preview_size` (a 400 `invalid_preview_size`: a card that is
 *    not exactly {@link ORG_CHART_SHARE_PREVIEW_SIZE}): the gateway refused
 *    what the client sent.
 *
 * The gateway's refusal body is `{"error": "<code>"}`.
 */
export const ORG_CHART_SHARE_REFUSALS = [
  "unavailable",
  "rate_limited",
  "signed_out",
  "account_deleted",
  "offline",
  "timed_out",
  "too_large",
  "not_an_image",
  "invalid_title",
  "invalid_preview_size",
] as const;
export type OrgChartShareRefusalCode =
  (typeof ORG_CHART_SHARE_REFUSALS)[number];

/** The `error` code of a refusal body, read off its raw text. */
function bodyCode(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null) return null;
    const code = (value as { error?: unknown }).error;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/**
 * The refusal a publish's HTTP status (and, for a 400, its body's code)
 * means, or null for an answer that is a failure rather than a refusal (a
 * 500, a 400 naming nothing this client knows).
 */
export function orgChartShareRefusalOf(
  status: number,
  body = "",
): OrgChartShareRefusalCode | null {
  switch (status) {
    case 400: {
      const code = bodyCode(body);
      if (code === "invalid_title") return "invalid_title";
      if (code === "invalid_preview_size") return "invalid_preview_size";
      return code === "invalid_image" || code === "no_file"
        ? "not_an_image"
        : null;
    }
    case 401:
      return "signed_out";
    case 404:
    case 405:
    case 501:
    case 503:
      return "unavailable";
    case 410:
      return bodyCode(body) === "account_deleted" ? "account_deleted" : null;
    case 413:
      return "too_large";
    case 415:
      return "not_an_image";
    case 429:
      return "rate_limited";
    default:
      return null;
  }
}

/**
 * Whether a refusal is a state of the deployment, the network or the session,
 * which nothing in Houston did wrong. The others mean the gateway refused a
 * picture, card or title the client drew itself, which is a bug.
 */
export function isExpectedOrgChartShareRefusal(
  code: OrgChartShareRefusalCode,
): boolean {
  return (
    code === "unavailable" ||
    code === "rate_limited" ||
    code === "signed_out" ||
    code === "account_deleted" ||
    code === "offline" ||
    code === "timed_out"
  );
}
