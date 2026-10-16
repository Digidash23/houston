import { Button } from "@houston-ai/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { StoreNav } from "@/components/store-nav";
import {
  getOrgChartShare,
  ORG_CHART_TAGLINE,
  orgChartPageShare,
  orgChartPreviewImage,
} from "@/lib/org-chart-share";
import { siteBase } from "@/lib/site-config";

/**
 * A shared org chart: the page a LinkedIn post links to. The post's preview
 * is the link card the app drew and uploaded with the chart (the chart
 * itself for a share with no card); a person who follows the link sees the
 * whole chart and a way to build their own team. Never indexed: the link is
 * the person's to share, not the store's to list. An unknown share is a 404;
 * a record the gateway could not hand over is a 5xx (`org-chart-share.ts`).
 */

export const dynamic = "force-dynamic";

/** The uploaded chart is a square PNG drawn at this size. */
const CHART_SIZE = 1200;

interface PageParams {
  params: Promise<{ id: string }>;
}

/**
 * One gateway read per request for the metadata and the page: a fetch with
 * an abort signal is left out of Next's own request dedupe.
 */
const pageShare = cache(async (id: string) =>
  orgChartPageShare(id, await getOrgChartShare(id)),
);

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { id } = await params;
  const share = await pageShare(id);
  if (!share) return { title: "Org chart not found", robots: { index: false } };
  const url = `${siteBase()}/o/${id}`;
  const description = `${ORG_CHART_TAGLINE}.`;
  const image = orgChartPreviewImage(share);
  return {
    title: share.title,
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      title: share.title,
      description,
      url,
      siteName: "Houston",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: share.title,
      description,
      images: [image],
    },
  };
}

export default async function OrgChartSharePage({ params }: PageParams) {
  const { id } = await params;
  const share = await pageShare(id);
  if (!share) notFound();

  return (
    <main className="canvas-screen min-h-dvh bg-background text-ink">
      <StoreNav />
      <div className="mx-auto grid w-full max-w-[1040px] gap-8 px-6 pt-8 pb-16 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center md:gap-12 md:px-8 md:pt-12">
        {/* biome-ignore lint/performance/noImgElement: the chart is served by the gateway, not a build-time asset */}
        <img
          src={share.imageUrl}
          alt={`The org chart of ${share.title}`}
          width={CHART_SIZE}
          height={CHART_SIZE}
          className="h-auto w-full rounded-2xl shadow-card"
        />
        <div className="flex flex-col items-start gap-4">
          <h1 className="text-balance font-normal text-2xl md:text-3xl">
            {share.title}
          </h1>
          <p className="text-base text-ink-muted">{ORG_CHART_TAGLINE}.</p>
          <Button asChild size="lg" className="mt-2 rounded-full px-7">
            <a href="https://gethouston.ai">Build your AI team</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
