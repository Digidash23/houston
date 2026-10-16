import { ORG_CHART_SHARE_PREVIEW_MAX_BYTES } from "@houston/wire-types";
import type { OrgTree } from "./org-chart-tree.ts";

/**
 * The landscape link card's tree and bytes. Pure and DOM-free.
 *
 * The card is half as tall as the square image and as wide, so a person's
 * stack of AI Employees is what runs out of room: each keeps
 * {@link LANDSCAPE_AGENTS} and the rest join its "+N". The header's counts
 * still name the whole space.
 */

export const LANDSCAPE_AGENTS = 2;

export function landscapeTree(tree: OrgTree): OrgTree {
  return {
    ...tree,
    branches: tree.branches.map((branch) =>
      branch.agents.length <= LANDSCAPE_AGENTS
        ? branch
        : {
            ...branch,
            agents: branch.agents.slice(0, LANDSCAPE_AGENTS),
            moreAgents:
              branch.moreAgents + branch.agents.length - LANDSCAPE_AGENTS,
          },
    ),
  };
}

export class LinkCardError extends Error {
  override name = "LinkCardError";
}

/**
 * The card's bytes: the PNG when it fits the gateway's cap (photos make a
 * busy chart heavy), else the JPEG. Throws when even the JPEG does not fit,
 * so the chart goes up without a card (the page then previews the square
 * chart) rather than the gateway refusing the whole upload.
 */
export async function encodeLinkCard(
  encodeAs: (type: "image/png" | "image/jpeg") => Promise<Blob>,
): Promise<Blob> {
  const png = await encodeAs("image/png");
  if (png.size <= ORG_CHART_SHARE_PREVIEW_MAX_BYTES) return png;
  const jpeg = await encodeAs("image/jpeg");
  if (jpeg.size <= ORG_CHART_SHARE_PREVIEW_MAX_BYTES) return jpeg;
  throw new LinkCardError(`link card is ${jpeg.size} bytes even as a JPEG`);
}
