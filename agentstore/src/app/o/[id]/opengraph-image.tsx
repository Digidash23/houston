import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/lib/og-card";
import { OgChartCard } from "@/lib/og-chart-card";
import { getOrgChartShare } from "@/lib/org-chart-share";

/**
 * The preview LinkedIn shows for an org chart link: the uploaded chart beside
 * its title. Falls back to the store's default card when the share or its
 * picture cannot be read (the page itself 404s on an unknown share).
 */

export const alt = "An org chart of AI Employees working in Houston";
export const size = OG_SIZE;
export const contentType = "image/png";

async function chartDataUrl(imageUrl: string): Promise<string | null> {
  const res = await fetch(imageUrl, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "image/png";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${bytes.toString("base64")}`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const share = await getOrgChartShare(id);
  const chart = share ? await chartDataUrl(share.imageUrl) : null;
  if (!share || !chart)
    return new ImageResponse(
      <OgCard
        kicker="gethouston.ai"
        title="Houston"
        subtitle="Build your team of AI Employees. No code, no terminal."
      />,
      size,
    );
  return new ImageResponse(
    <OgChartCard title={share.title} chart={chart} />,
    size,
  );
}
