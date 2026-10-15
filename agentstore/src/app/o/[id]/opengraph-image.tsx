import { ImageResponse } from "next/og";
import { OG_SIZE } from "@/lib/og-card";
import { orgChartOgImage } from "@/lib/org-chart-og";
import { getOrgChartImage } from "@/lib/org-chart-share";

/**
 * The preview LinkedIn shows for an org chart link: the uploaded chart on its
 * own paper. Any failure answers the store's branded card (`org-chart-og`).
 */

export const alt = "An org chart of AI Employees working in Houston";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return orgChartOgImage(id, {
    image: getOrgChartImage,
    render: (card) => new ImageResponse(card, size),
  });
}
