import { type JSX, useId } from "react";
import { cn } from "../utils";
import { avatarHelmetSize, HoustonHelmet } from "./houston-avatar";
import { BOX, SQUIRCLE } from "./manager-avatar-geometry";

export interface ManagerAvatarProps {
  /** The full square box, in pixels. */
  size: number;
  className?: string;
}

/** The filled primary Button's resting fill, rim and label (canvas.css §4). */
const FILL = "var(--ht-cta)";
const RIM = "var(--ht-cta-rim)";
const LABEL = "var(--ht-cta-text)";

/** A pixel length in viewBox units, rounded so the markup stays short. */
function units(px: number, size: number): number {
  return Number(((px * BOX) / size).toFixed(3));
}

/**
 * The AI Manager's mark: the AI Employee helmet on a squircle of the filled
 * primary Button's own material. The plate wears the Button's resting fill
 * and its 1px inset rim, the helmet wears the Button's label colour, each read
 * from the same `--ht-cta*` token the Button reads, so the mark matches it in
 * both themes and every palette and follows any change to it. Flat, like the
 * Button. The dark Button's backdrop blur is an effect, not a colour, and is
 * left out: the mark sits on its row's own surface, where a blur changes no
 * pixel and would only cost a compositing layer. The helmet takes the employee
 * avatar's ratio at the rendered size, so it sits on whole pixels exactly as
 * it does in a HoustonAvatar of that size. Decorative: the Manager's label
 * beside it is the accessible name.
 */
export function ManagerAvatar({
  size,
  className,
}: ManagerAvatarProps): JSX.Element {
  // useId carries characters a `url(#…)` reference would have to escape.
  const clipId = `manager-${useId().replace(/[^\w-]/g, "")}-clip`;
  const glyphPx = avatarHelmetSize(size);
  const glyph = units(glyphPx, size);
  const inset = units((size - glyphPx) / 2, size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
      data-manager-avatar=""
    >
      {/* Token colours go through `style`: a `var()` in a presentation
          attribute does not resolve in every webview. */}
      <defs>
        <clipPath id={clipId}>
          <path d={SQUIRCLE} />
        </clipPath>
      </defs>
      <path d={SQUIRCLE} style={{ fill: FILL }} />
      {/* The Button's rim is a 1px inset ring. A 2px stroke clipped to the
          shape leaves exactly 1px inside it, at every size. */}
      <path
        d={SQUIRCLE}
        fill="none"
        style={{ stroke: RIM }}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        clipPath={`url(#${clipId})`}
      />
      <g transform={`translate(${inset} ${inset})`}>
        <HoustonHelmet color={LABEL} size={glyph} />
      </g>
    </svg>
  );
}
