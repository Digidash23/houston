import { ORG_CHART_SHARE_PREVIEW_MAX_BYTES } from "@houston/wire-types";
import { ShareCardError } from "./org-chart-share-card";
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
 * (photos make a busy chart heavy) goes up as a JPEG instead.
 */

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
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ShareCardError(`canvas produced no ${type}`));
      },
      type,
      0.92,
    ),
  );
}

/** Draw the link card around `chart`, the drawn share PNG. */
export async function renderShareLinkCard(
  chart: Blob,
  words: LinkCardWords,
): Promise<Blob> {
  const image = await loadChart(chart);
  const canvas = document.createElement("canvas");
  canvas.width = LINK_CARD.width;
  canvas.height = LINK_CARD.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ShareCardError("canvas 2d context unavailable");
  const layout = linkCardLayout(ctx, words);
  paintPaper(ctx, LINK_CARD.width, LINK_CARD.height);
  paintChart(ctx, layout.chart, image);
  paintLines(ctx, layout.tagline, layout.column.x, ART.ink);
  paintLines(ctx, layout.call, layout.column.x, ART.muted);
  const png = await encode(canvas, "image/png");
  return png.size <= ORG_CHART_SHARE_PREVIEW_MAX_BYTES
    ? png
    : encode(canvas, "image/jpeg");
}
