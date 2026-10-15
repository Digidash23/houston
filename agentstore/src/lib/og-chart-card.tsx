import type { ReactElement } from "react";
import { OG_SIZE, OG_TEXT, OgBackdrop } from "./og-card";

/**
 * The share card of an org chart page (`/o/[id]`). LinkedIn shows a link's
 * preview at 1.91:1 and the chart is square, so the chart fills the card's
 * height on the left and the words sit beside it.
 */

export const ORG_CHART_TAGLINE = "AI Employees working in Houston";

export function OgChartCard({
  title,
  chart,
}: {
  title: string;
  /** The chart PNG, as a data URL so the render never refetches it. */
  chart: string;
}): ReactElement {
  return (
    <OgBackdrop style={{ flexDirection: "row", alignItems: "stretch" }}>
      {/* biome-ignore lint/performance/noImgElement: next/og renders plain img only */}
      <img
        src={chart}
        alt=""
        width={OG_SIZE.height}
        height={OG_SIZE.height}
        style={{ objectFit: "contain" }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "56px 64px 56px 48px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: OG_TEXT.kicker,
            marginBottom: 18,
          }}
        >
          Org chart
        </div>
        <div
          style={{
            display: "block",
            fontSize: 56,
            fontWeight: 600,
            letterSpacing: -1.5,
            lineHeight: 1.1,
            lineClamp: 3,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            lineHeight: 1.35,
            color: OG_TEXT.muted,
            marginTop: 20,
          }}
        >
          {ORG_CHART_TAGLINE}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: OG_TEXT.kicker,
            marginTop: 40,
          }}
        >
          gethouston.ai
        </div>
      </div>
    </OgBackdrop>
  );
}
