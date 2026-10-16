import { drawShareCanvas } from "./org-chart-share-card";
import { LANDSCAPE_FRAME } from "./org-chart-share-card-geometry";
import type { ShareCardText } from "./org-chart-share-card-paint";
import type { CardWords } from "./org-chart-share-columns";
import {
  encodeLinkCard,
  LinkCardError,
  landscapeTree,
} from "./org-chart-share-landscape";
import type { OrgTree } from "./org-chart-tree";

/**
 * The link card: the 1200 x 630 picture the chart's page previews with. It
 * is the org chart alone, drawn by the share image's own renderer in the
 * landscape frame (`LANDSCAPE_FRAME`, `landscapeTree`), and encoded under
 * the gateway's cap (`encodeLinkCard`).
 */

function encode(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new LinkCardError(`canvas produced no ${type}`));
      },
      type,
      0.92,
    ),
  );
}

/** Draw `tree` as the link card, with the share image's own words. */
export async function renderShareLinkCard(
  tree: OrgTree,
  text: ShareCardText,
  words: CardWords,
): Promise<Blob> {
  const canvas = await drawShareCanvas(
    landscapeTree(tree),
    text,
    words,
    LANDSCAPE_FRAME,
  );
  return encodeLinkCard((type) => encode(canvas, type));
}
