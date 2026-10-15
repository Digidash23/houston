import type { StorageState } from "./state-merge";

/**
 * Anti-bot vendors' own cookies (Cloudflare, Akamai, PerimeterX, DataDome,
 * Imperva, AWS WAF). They mark the browser that earned them; one a blocked
 * browser earned gets the backup blocked as well (seen with PerimeterX).
 */
const WALL_COOKIE =
  /^(?:__cf_bm|cf_clearance|_abck|bm_sz|bm_sv|ak_bmsc|_px\w*|pxcts|datadome|incap_ses_\w*|visid_incap_\w*|nlbi_\w*|aws-waf-token)$/;

/**
 * The saved sign-ins a backup browser opened for `host` gets: only that
 * site's, never the wall's cookies. Kernel sees everything it is given, so
 * the agent's other sign-ins stay here. What is left out is also left out of
 * the tab's base, so saving back never reads it as signed out.
 */
export function backupState(state: StorageState, host: string): StorageState {
  return {
    cookies: state.cookies.filter(
      (c) => !WALL_COOKIE.test(c.name) && sameSite(c.domain, host),
    ),
    origins: state.origins.filter((o) => sameSite(originHost(o.origin), host)),
  };
}

/**
 * Whether a cookie or storage `domain` belongs to `host`'s site: one the page
 * would be sent (`host` or a parent), or one under the site the page is on
 * (a sign-in on `login.` for a page on `www.`).
 */
function sameSite(domain: string, host: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  if (!d || !h) return false;
  const site = h.replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`) || d === site || d.endsWith(`.${site}`);
}

function originHost(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    // A saved origin that is not a URL belongs to no site.
    return "";
  }
}
