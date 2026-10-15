import { serveBrowserInput, serveBrowserLive } from "./browser-live-http";
import type { RouteContext } from "./http-helpers";

/**
 * The browser hand-off's live view (session/tools/browser/live/): frames down
 * an SSE stream, the person's input up in POST batches. Same handlers in
 * server mode (here) and turn mode (turn/server.ts).
 */
export async function handleBrowserLiveRoute(
  ctx: RouteContext,
): Promise<boolean> {
  const liveMatch = ctx.path.match(/^\/conversations\/([^/]+)\/browser\/live$/);
  if (ctx.method === "GET" && liveMatch) {
    serveBrowserLive(
      ctx.req,
      ctx.res,
      decodeURIComponent(liveMatch[1]),
      ctx.url,
    );
    return true;
  }
  const inputMatch = ctx.path.match(
    /^\/conversations\/([^/]+)\/browser\/input$/,
  );
  if (ctx.method === "POST" && inputMatch) {
    await serveBrowserInput(
      ctx.req,
      ctx.res,
      decodeURIComponent(inputMatch[1]),
    );
    return true;
  }
  return false;
}
