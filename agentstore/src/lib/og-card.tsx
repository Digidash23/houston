import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * Shared layout for the store's OpenGraph share cards (the default site card,
 * the per-agent card under /a/[slug], and the org chart card under /o/[id]). Rendered by next/og ImageResponse
 * (Satori), so only its CSS subset is used: flex layout, gradients, no
 * external assets — the space look is painted with gradients + star dots so
 * a card never depends on a network fetch.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const STARS: ReadonlyArray<{ x: number; y: number; s: number; o: number }> = [
  { x: 80, y: 90, s: 3, o: 0.9 },
  { x: 240, y: 40, s: 2, o: 0.5 },
  { x: 420, y: 130, s: 3, o: 0.8 },
  { x: 600, y: 60, s: 2, o: 0.45 },
  { x: 780, y: 150, s: 3, o: 0.7 },
  { x: 950, y: 50, s: 2, o: 0.55 },
  { x: 1100, y: 120, s: 3, o: 0.85 },
  { x: 160, y: 500, s: 2, o: 0.5 },
  { x: 360, y: 560, s: 3, o: 0.7 },
  { x: 560, y: 520, s: 2, o: 0.4 },
  { x: 760, y: 580, s: 3, o: 0.75 },
  { x: 980, y: 540, s: 2, o: 0.5 },
  { x: 1130, y: 470, s: 3, o: 0.8 },
];

export interface OgCardProps {
  /** Small uppercase line above the title (e.g. "Houston Agent Store"). */
  kicker: string;
  /** The big line. Keep under ~60 chars; the card clamps to two lines. */
  title: string;
  /** Supporting line under the title. */
  subtitle: string;
  /** Optional right-aligned chip (e.g. the agent's category). */
  chip?: string;
}

/** The card's text colours, for a layout that composes {@link OgBackdrop}. */
export const OG_TEXT = {
  ink: "#ffffff",
  muted: "rgba(255,255,255,0.72)",
  kicker: "rgba(255,255,255,0.6)",
} as const;

/** The space backdrop every card is painted on: the gradients and stars. */
export function OgBackdrop({
  style,
  children,
}: {
  style?: CSSProperties;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: "#05060d",
        backgroundImage:
          "radial-gradient(ellipse 90% 70% at 75% 10%, rgba(96,110,180,0.35), rgba(5,6,13,0) 60%), radial-gradient(ellipse 70% 55% at 15% 85%, rgba(180,120,80,0.18), rgba(5,6,13,0) 55%)",
        color: OG_TEXT.ink,
        fontFamily: "sans-serif",
        position: "relative",
        ...style,
      }}
    >
      {STARS.map((star) => (
        <div
          key={`${star.x}-${star.y}`}
          style={{
            position: "absolute",
            left: star.x,
            top: star.y,
            width: star.s,
            height: star.s,
            borderRadius: 9999,
            backgroundColor: "#ffffff",
            opacity: star.o,
          }}
        />
      ))}
      {children}
    </div>
  );
}

export function OgCard({
  kicker,
  title,
  subtitle,
  chip,
}: OgCardProps): ReactElement {
  return (
    <OgBackdrop
      style={{
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 72,
      }}
    >
      {chip ? (
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 72,
            display: "flex",
            padding: "10px 24px",
            borderRadius: 9999,
            border: "1px solid rgba(255,255,255,0.25)",
            backgroundColor: "rgba(13,15,24,0.7)",
            fontSize: 26,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {chip}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          fontSize: 28,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: OG_TEXT.kicker,
          marginBottom: 18,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: 600,
          letterSpacing: -2,
          lineHeight: 1.1,
          maxWidth: 1000,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 32,
          lineHeight: 1.4,
          color: OG_TEXT.muted,
          marginTop: 22,
          maxWidth: 940,
        }}
      >
        {subtitle}
      </div>
    </OgBackdrop>
  );
}
