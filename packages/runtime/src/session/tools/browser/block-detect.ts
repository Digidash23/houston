/**
 * Which anti-bot wall stopped the page. A block moves the conversation's tab
 * to the backup browser (Kernel), a third party that then sees the page and
 * its cookies, so every rule needs a vendor's own marker: an ordinary
 * "Forbidden" or "Access denied, please sign in" is never a block. A marker
 * a page could merely quote (an article or a forum post about the wall) only
 * counts as a tag (the serialized DOM escapes a quoted `<`) or with a denied
 * status.
 */
export type BlockReason =
  | "cloudflare"
  | "akamai"
  | "perimeterx"
  | "datadome"
  | "imperva"
  | "aws_waf"
  | "amazon"
  | "denied_status"
  | "connection_reset";

export type Block =
  | { reason: BlockReason }
  /** Kernel's own proxy refused the site (provider_blacklisted and kin). */
  | { reason: "backup_proxy"; code: string };

export interface LoadedPage {
  /** The main document's HTTP status; null when there was no response. */
  status: number | null;
  title: string;
  /** The start of the document's HTML. */
  html: string;
}

/** Statuses an anti-bot answer comes with; a generic rule needs one of these. */
const DENIED_STATUSES = new Set([403, 429, 451, 503]);

const denied = (status: number | null) =>
  status !== null && DENIED_STATUSES.has(status);

/**
 * Phrases a bot block says, and an ordinary refused page does not. Read
 * outside scripts: a sign-in page loads a reCAPTCHA script on any status.
 */
const BOT_WORDS =
  /\bcaptcha\b|unusual traffic|are you a robot|not a robot|robot or human|verify (?:that )?you are (?:a )?human|automated (?:access|queries|requests)|you have been blocked|request blocked|bot detection/i;

interface Wall {
  reason: BlockReason;
  matches(page: LoadedPage): boolean;
}

const WALLS: readonly Wall[] = [
  {
    reason: "cloudflare",
    // The challenge interstitial, by its title and Cloudflare's own script.
    matches: ({ title, html }) =>
      /^(just a moment|attention required! \| cloudflare)/i.test(title) &&
      /challenges\.cloudflare\.com|cf[-_]chl|cf-error-details|cloudflare ray id/i.test(
        html,
      ),
  },
  {
    reason: "cloudflare",
    // A branded WAF block page ("Blocked - Indeed.com", 403). Cloudflare's
    // ray id alone is on any page it serves, so the title must say "blocked".
    matches: ({ status, title, html }) =>
      denied(status) &&
      /\bblocked\b/i.test(title) &&
      /cloudflare ray id|cf-ray|cf-error-details|cdn-cgi\//i.test(html),
  },
  {
    reason: "akamai",
    // Akamai's stock page; the DOM serializes its &#35; back to "#".
    matches: ({ status, title, html }) =>
      status === 403 &&
      /^access denied$/i.test(title.trim()) &&
      /Reference #/.test(html) &&
      /errors\.edgesuite\.net|You don't have permission to access/i.test(html),
  },
  {
    reason: "perimeterx",
    matches: ({ status, title, html }) =>
      /<div[^>]+id=["']px-captcha["']/.test(html) ||
      (/^robot or human\??$/i.test(title.trim()) &&
        /perimeterx|_pxAppId|px-cloud|px-cdn/i.test(html)) ||
      (denied(status) &&
        /Press (?:&amp;|&) Hold/.test(html) &&
        /perimeterx|_pxAppId/i.test(html)),
  },
  {
    reason: "datadome",
    matches: ({ html }) =>
      /<iframe[^>]+src=["'][^"']*captcha-delivery\.com/i.test(html),
  },
  {
    reason: "imperva",
    // Its block page frames or loads `_Incapsula_Resource`, often on a 200.
    matches: ({ status, html }) =>
      /Incapsula incident ID/i.test(html) &&
      (denied(status) ||
        /<(?:iframe|script)[^>]+src=["'][^"']*_Incapsula_Resource/i.test(html)),
  },
  {
    reason: "aws_waf",
    // A site behind AWS WAF loads its challenge script on ordinary pages
    // too; only the interstitial answers 202/405 with gokuProps.
    matches: ({ status, html }) =>
      (status === 202 || status === 405) && /window\.gokuProps/.test(html),
  },
  {
    reason: "amazon",
    // Its robot check, and the 503 "dogs" page it throttles robots with.
    matches: ({ status, title, html }) =>
      /<form[^>]+action=["'][^"']*\/errors\/validateCaptcha/.test(html) ||
      (denied(status) &&
        /To discuss automated access to Amazon data please contact/.test(
          html,
        )) ||
      (status === 503 &&
        /^sorry! something went wrong!?$/i.test(title.trim()) &&
        /amazon\.com|media-amazon\.com|ssl-images-amazon/i.test(html)),
  },
];

const SCRIPT_OR_STYLE =
  /<script\b[\s\S]*?<\/script[^>]*>|<style\b[\s\S]*?<\/style[^>]*>/i;

/** The anti-bot wall `page` shows, or null for any other page. */
export function pageBlock(page: LoadedPage): Block | null {
  const wall = WALLS.find((w) => w.matches(page));
  if (wall) return { reason: wall.reason };
  if (!denied(page.status)) return null;
  // Only tested for words, never rendered: scripts and styles are dropped
  // so a word in code does not count as the page saying it.
  const prose = page.html.split(SCRIPT_OR_STYLE).join("\n");
  return BOT_WORDS.test(`${page.title}\n${prose}`)
    ? { reason: "denied_status" }
    : null;
}

/**
 * Connection errors an anti-bot edge answers a fingerprinted client with.
 * DNS failures, refusals and timeouts mean the site is down, not a block.
 */
const BLOCKED_CONNECTION =
  /net::ERR_(?:HTTP2_PROTOCOL_ERROR|CONNECTION_RESET|EMPTY_RESPONSE)\b/;

/** A navigation error that reads as an anti-bot reset, or null. */
export function connectionBlock(error: unknown): Block | null {
  if (!(error instanceof Error) || error.name === "BrowserToolError")
    return null;
  return BLOCKED_CONNECTION.test(error.message)
    ? { reason: "connection_reset" }
    : null;
}
