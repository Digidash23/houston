import type { ReactElement } from "react";
import { OG_PAPER, OG_SIZE } from "./og-card";

/**
 * The share card of an org chart page (`/o/[id]`). LinkedIn shows a link's
 * preview at 1.91:1 and the chart is square, so the chart sits inset on the
 * left, on the same dotted paper it was drawn on, and the right says what it
 * is. The chart already carries the team's name, so the words never repeat it.
 */

export const ORG_CHART_TAGLINE = "AI Employees working in Houston";
export const ORG_CHART_CALL = "Build your AI team · gethouston.ai";

/** The gap between the card's edge and the chart. */
const INSET = 28;
const CHART = OG_SIZE.height - INSET * 2;

const { step, r } = OG_PAPER.grid;

/**
 * The paper's dot grid as one SVG pattern: Satori draws a tiny radial
 * gradient tile almost blank, so the dots are drawn the way the app's canvas
 * draws them, one circle per 24 px cell, centred in the cell.
 */
const DOT_GRID = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.width}" height="${OG_SIZE.height}"><defs><pattern id="d" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="${OG_PAPER.dot}"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`,
)}`;

export function OgChartCard({
  chart,
}: {
  /** The chart PNG, as a data URL so the render never refetches it. */
  chart: string;
}): ReactElement {
  return (
    <div
      style={{
        backgroundColor: OG_PAPER.paper,
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: INSET,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/og renders plain img only */}
      <img
        src={DOT_GRID}
        alt=""
        width={OG_SIZE.width}
        height={OG_SIZE.height}
        style={{ position: "absolute", left: 0, top: 0 }}
      />
      <div
        style={{
          display: "flex",
          width: CHART,
          height: CHART,
          borderRadius: 18,
          border: `1px solid ${OG_PAPER.hairline}`,
          boxShadow: OG_PAPER.shadow,
          overflow: "hidden",
          backgroundColor: OG_PAPER.paper,
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: next/og renders plain img only */}
        <img src={chart} alt="" width={CHART} height={CHART} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "0 44px 0 56px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 54,
            letterSpacing: -1.5,
            lineHeight: 1.08,
            color: OG_PAPER.ink,
          }}
        >
          {ORG_CHART_TAGLINE}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            lineHeight: 1.35,
            color: OG_PAPER.muted,
            marginTop: 24,
          }}
        >
          {ORG_CHART_CALL}
        </div>
      </div>
    </div>
  );
}
