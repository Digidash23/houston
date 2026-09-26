/**
 * The AI Manager plate's outline, in the avatar's 100-unit viewBox. Pure and
 * deterministic: one path, built once at import and shared by every instance.
 */

/** The viewBox the plate and everything on it are drawn in. */
export const BOX = 100;
/** The superellipse exponent: an app icon's continuous corner, rounder than a
 *  rounded square and squarer than a circle. */
const EXPONENT = 5;
/** Enough vertices that no facet is visible at the largest mounted size. */
const SAMPLES = 96;

/**
 * |x/r|^n + |y/r|^n = 1, sampled as a closed path. A true superellipse drawn
 * in SVG, because CSS `corner-shape` does not render in WebKit (the macOS
 * webview) and a border radius is a different, flatter curve.
 */
function superellipsePath(): string {
  const r = BOX / 2;
  const at = (value: number) =>
    Number(
      (r + r * Math.sign(value) * Math.abs(value) ** (2 / EXPONENT)).toFixed(2),
    );
  const points = Array.from({ length: SAMPLES }, (_, step) => {
    const angle = (step / SAMPLES) * 2 * Math.PI;
    return `${at(Math.cos(angle))} ${at(Math.sin(angle))}`;
  });
  return `M${points.join(" L")} Z`;
}

export const SQUIRCLE = superellipsePath();
