import { Button } from "@houston-ai/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { StoreNav } from "@/components/store-nav";
import { ORG_CHART_TAGLINE } from "@/lib/og-chart-card";
import { getOrgChartShare, orgChartPageView } from "@/lib/org-chart-share";
import { siteBase } from "@/lib/site-config";

/**
 * A shared org chart: the page a LinkedIn post links to. The post's preview
 * comes from this route's opengraph-image; a person who follows the link
 * sees the whole chart and a way to build their own team. Never indexed:
 * the link is the person's to share, not the store's to list. A gateway that
 * cannot answer gets a plain title and the way to build a team, without the
 * chart (its address is in the record it could not read); only an unknown
 * share is a 404.
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
const pageView = cache(async (id: string) =>
  orgChartPageView(await getOrgChartShare(id)),
);

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { id } = await params;
  const view = await pageView(id);
  if (!view) return { title: "Org chart not found", robots: { index: false } };
  const url = `${siteBase()}/o/${id}`;
  const description = `${ORG_CHART_TAGLINE}.`;
  return {
    title: view.title,
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      title: view.title,
      description,
      url,
      siteName: "Houston",
    },
    twitter: {
      card: "summary_large_image",
      title: view.title,
      description,
    },
  };
}

export default async function OrgChartSharePage({ params }: PageParams) {
  const { id } = await params;
  const view = await pageView(id);
  if (!view) notFound();

  return (
    <main className="canvas-screen min-h-dvh bg-background text-ink">
      <StoreNav />
      <div
        className={
          view.imageUrl
            ? "mx-auto grid w-full max-w-[1040px] gap-8 px-6 pt-8 pb-16 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center md:gap-12 md:px-8 md:pt-12"
            : "mx-auto grid w-full max-w-[640px] gap-8 px-6 pt-8 pb-16 md:px-8 md:pt-12"
        }
      >
        {view.imageUrl && (
          // biome-ignore lint/performance/noImgElement: the chart is served by the gateway, not a build-time asset
          <img
            src={view.imageUrl}
            alt={`The org chart of ${view.title}`}
            width={CHART_SIZE}
            height={CHART_SIZE}
            className="h-auto w-full rounded-2xl shadow-card"
          />
        )}
        <div className="flex flex-col items-start gap-4">
          <h1 className="text-balance font-normal text-2xl md:text-3xl">
            {view.title}
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
