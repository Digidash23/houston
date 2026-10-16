import type { OrgTree, OrgTreeCaps } from "./org-chart-tree.ts";

/**
 * What sharing the org chart says and where it goes. Pure and DOM-free:
 * the post text, the image's file name and LinkedIn's share link.
 */

/**
 * What the square share image holds (`org-chart-share-layout.ts`): six
 * people across, three AI Employees under each, then "+N".
 */
export const SHARE_CARD_CAPS: OrgTreeCaps = {
  people: 6,
  agentsPerPerson: 3,
  rootAgents: 6,
};

/** The subset of i18next's `t` the post builder needs. */
export type Translate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** Where the post points when the chart has no page of its own. */
export const SHARE_SITE_LINK = "gethouston.ai";

/**
 * The post that goes with the image: the space's name, then `link`, the
 * chart's own page (whose preview is the image) or {@link SHARE_SITE_LINK}.
 * A personal space speaks of the person's own AI Employees.
 */
export function sharePostText(
  t: Translate,
  tree: OrgTree,
  link: string,
): string {
  return tree.root.kind === "person"
    ? t("orgChart.share.postPersonal", { link })
    : t("orgChart.share.post", { company: tree.root.name, link });
}

/** The name the chart is drawn under: the space, or the personal space's person. */
export function shareTitle(tree: OrgTree): string {
  return tree.root.kind === "person" ? tree.root.person.name : tree.root.name;
}

/**
 * `<company>-org-chart.png`, safe on every file system: accents folded,
 * anything but letters and digits collapsed to one hyphen, capped so a long
 * name never makes an unwieldy file. A name with nothing usable left is
 * just `org-chart.png`.
 */
export function shareFileName(company: string): string {
  const slug = company
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug ? `${slug}-org-chart.png` : "org-chart.png";
}

/**
 * LinkedIn's compose link with the post text filled in. It cannot carry an
 * image: the image travels as the preview of the chart's page linked in the
 * post, else the person adds the downloaded image themselves.
 */
export function linkedInShareUrl(text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
}

/** Whether a share sheet rejection is the person closing it, not a failure. */
export function isShareCancel(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/**
 * Whether a share sheet rejection is the sheet already being open (a second
 * tap while it is up): the first share is still running, not a failure.
 */
export function isShareBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "InvalidStateError"
  );
}

/**
 * How a share left, as tracked: LinkedIn with the image as the preview of
 * the chart's page linked in the post, LinkedIn with the post alone (the
 * page or the image could not be made), the share sheet, or the dialog's
 * Download image and Copy image.
 */
export type ShareChannel =
  | "linkedin_link"
  | "linkedin_text_only"
  | "native"
  | "download"
  | "copy_image";
