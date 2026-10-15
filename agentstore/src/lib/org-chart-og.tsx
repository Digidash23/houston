import type { ReactElement } from "react";
import { OgCard } from "./og-card";
import { OgChartCard } from "./og-chart-card";
import type { OrgChartImageLookup } from "./org-chart-share";

/**
 * What `/o/[id]/opengraph-image` answers: the chart on its card, or the
 * store's branded card when the picture cannot be had (an unknown share, a
 * gateway that is slow or refusing, a picture the renderer chokes on). A
 * crawler never gets a 500: LinkedIn keeps a broken preview for days.
 *
 * The render is drained here, not handed back as a stream, so a failure
 * inside it is caught while there is still a card to send instead.
 */

export interface OrgChartOgDeps {
  image: (id: string) => Promise<OrgChartImageLookup>;
  render: (card: ReactElement) => Response;
}

export function OrgChartFallbackCard(): ReactElement {
  return (
    <OgCard
      kicker="gethouston.ai"
      title="Houston"
      subtitle="Build your team of AI Employees. No code, no terminal."
    />
  );
}

async function drained(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`card render answered ${res.status}`);
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: res.headers,
  });
}

export async function orgChartOgImage(
  id: string,
  deps: OrgChartOgDeps,
): Promise<Response> {
  try {
    const image = await deps.image(id);
    if (image.kind === "found")
      return await drained(deps.render(<OgChartCard chart={image.dataUrl} />));
  } catch (err) {
    console.error(`agentstore: org chart card ${id} failed`, err);
  }
  return drained(deps.render(<OrgChartFallbackCard />));
}
