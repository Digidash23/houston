import { ORG_CHART_SHARE_PREVIEW_MAX_BYTES } from "@houston/wire-types";
import { ART, paintPaper, roundRect, track } from "./org-chart-share-card-art";
import {
  LINK_CARD,
  type LinkCardLayout,
  type LinkCardLines,
  type LinkCardWords,
  linkCardLayout,
} from "./org-chart-share-link-card-layout";

/**
 * The link card: the 1200 x 630 picture the chart's page previews with,
 * drawn on the device around the share PNG (`linkCardLayout`). Canvas 2D
 * only, like the share image itself. A PNG past the gateway's cap for a card
 * (photos make a busy chart heavy) goes up as a JPEG instead, and a JPEG
 * still past it is no card at all (the page then previews the chart).
 */

export class LinkCardError extends Error {
  override name = "LinkCardError";
}

/** The canvas the card is painted on: a real one, or a test's stand-in. */
export interface LinkCardCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
  toBlob(
    done: (blob: Blob | null) => void,
    type: string,
    quality: number,
  ): void;
}

function loadChart(png: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(png);
  const image = new Image();
  image.src = url;
  return image
    .decode()
    .then(() => image)
    .finally(() => URL.revokeObjectURL(url));
}

function paintChart(
  ctx: CanvasRenderingContext2D,
  chart: LinkCardLayout["chart"],
  image: CanvasImageSource,
) {
  const { x, y, size, radius } = chart;
  ctx.save();
  for (const [color, blur, dy] of [
    [ART.liftFar, 40, 18],
    [ART.liftNear, 2, 1],
  ] as const) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = dy;
    roundRect(ctx, x, y, size, size, radius);
    ctx.fillStyle = ART.paper;
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, radius);
  ctx.lineWidth = 1;
  ctx.strokeStyle = ART.hairline;
  ctx.stroke();
}

function paintLines(
  ctx: CanvasRenderingContext2D,
  text: LinkCardLines,
  x: number,
  color: string,
) {
  ctx.font = text.font;
  track(ctx, text.tracking);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  text.lines.forEach((line, i) => {
    ctx.fillText(line, x, text.baselines[i] ?? 0);
  });
  track(ctx, 0);
}

function encode(
  canvas: LinkCardCanvas,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new LinkCardError(`canvas produced no ${type}`));
      },
      type,
      0.92,
    ),
  );
}

/**
 * The card's bytes: the PNG when it fits the gateway's cap, else the JPEG.
 * Throws when even the JPEG does not fit, so the chart goes up without a
 * card rather than the gateway refusing the whole upload.
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

/** Paint the link card around `image` on `canvas`, and encode it. */
export function paintLinkCard(
  canvas: LinkCardCanvas,
  image: CanvasImageSource,
  words: LinkCardWords,
): Promise<Blob> {
  canvas.width = LINK_CARD.width;
  canvas.height = LINK_CARD.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LinkCardError("canvas 2d context unavailable");
  const layout = linkCardLayout(ctx, words);
  paintPaper(ctx, LINK_CARD.width, LINK_CARD.height);
  paintChart(ctx, layout.chart, image);
  paintLines(ctx, layout.tagline, layout.column.x, ART.ink);
  paintLines(ctx, layout.call, layout.column.x, ART.muted);
  return encodeLinkCard((type) => encode(canvas, type));
}

/** Draw the link card around `chart`, the drawn share PNG. */
export async function renderShareLinkCard(
  chart: Blob,
  words: LinkCardWords,
): Promise<Blob> {
  const image = await loadChart(chart);
  return paintLinkCard(document.createElement("canvas"), image, words);
}
