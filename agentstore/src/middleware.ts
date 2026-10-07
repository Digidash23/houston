import { type NextRequest, NextResponse } from "next/server";

/**
 * Vanity creator URLs: `/@handle` is the canonical, shareable address of a
 * creator's public page, internally served by `/creators/[handle]`. We REWRITE
 * (not redirect) so the address bar keeps the pretty `/@handle` while the app
 * renders the real route. The pattern mirrors the gateway's handle grammar
 * (`^[a-z0-9][a-z0-9_]{1,29}$` — lowercase, 2–30 chars); anything else falls
 * through untouched (a bad handle 404s on the real page). The `@` is percent
 * decoded to `%40` by browsers in some cases, so we match both forms.
 */
const HANDLE_PATH = /^\/(?:@|%40)([a-z0-9][a-z0-9_]{1,29})$/;

/**
 * This server only reads. It defines no Server Actions, and its Route Handlers
 * export only GET plus OPTIONS for CORS preflight; every write goes from the
 * browser straight to the gateway. Next still hands a POST to any page to its
 * Server Action decoder, the code React2Shell (CVE-2025-55182) exploited, and
 * scanners keep probing it. Refusing other methods here keeps those requests
 * away from the decoder and out of the logs.
 */
const READ_METHODS = new Set(["GET", "HEAD"]);
const API_PREFIX = "/api/";

function isAllowedMethod(method: string, pathname: string): boolean {
  if (READ_METHODS.has(method)) return true;
  return method === "OPTIONS" && pathname.startsWith(API_PREFIX);
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (!isAllowedMethod(request.method, pathname)) {
    const allow = pathname.startsWith(API_PREFIX)
      ? "GET, HEAD, OPTIONS"
      : "GET, HEAD";
    return new NextResponse(null, { status: 405, headers: { allow } });
  }
  const match = pathname.match(HANDLE_PATH);
  if (match) {
    const url = request.nextUrl.clone();
    url.pathname = `/creators/${match[1]}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  // Every path except hashed build assets, so the method guard covers pages,
  // unknown paths and the API alike.
  matcher: ["/((?!_next/static/).*)"],
};
