/**
 * What the rail's connect group draws beside each row's label, as pure rules
 * (`use-connect-group-logos.tsx` feeds them the person's connections and draws
 * the result; `app/tests/connect-group-logos.test.ts` pins them).
 *
 * A row always shows three logos, so it says what the menu behind it is about
 * before anyone opens it: what the person already connected comes first, and
 * the popular choices fill the rest. Only a logo that can be drawn right now
 * is ever listed: a row never paints an image that has not resolved, so it
 * cannot flash a broken one. Every popular choice's mark ships in the bundle,
 * so both rows always draw three.
 */

/** The apps that fill the apps row: Gmail, Outlook, Slack, as
 *  the integration catalog slugs them. Their marks ship in the bundle
 *  (`connect-apps-bundled-logos.ts`), so they draw with no catalog at all. */
export const CONNECT_APPS_FALLBACK = ["gmail", "outlook", "slack"] as const;

/** The AI providers that fill the AI row. */
export const CONNECT_AI_FALLBACK = ["anthropic", "openai", "google"] as const;

export interface ConnectLogoPick {
  /** What the person has connected, in the order to draw it; `null` while
   *  that cannot be told yet. */
  connected: readonly string[] | null;
  /** The popular choices that fill the row after what is connected. */
  fallback: readonly string[];
  /** Whether an id's logo can be drawn right now. */
  drawable: (id: string) => boolean;
  /** Ids that draw the same logo share an identity and are drawn once. */
  identity?: (id: string) => string;
  max: number;
}

/** The ids a connect row draws: connected ones first, then the fallback, at
 *  most `max`, each logo once. */
export function pickConnectLogoIds(pick: ConnectLogoPick): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...(pick.connected ?? []), ...pick.fallback]) {
    if (out.length >= pick.max) break;
    const key = pick.identity ? pick.identity(id) : id;
    if (seen.has(key) || !pick.drawable(id)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** The apps row's ids: connected apps first, drawable once their logo is
 *  known (`knownLogo` returns "" for an unknown one), then the popular apps,
 *  whose bundled marks always draw. */
export function pickConnectAppIds(pick: {
  connected: readonly string[] | null;
  knownLogo: (slug: string) => string;
  max: number;
}): string[] {
  const bundled: ReadonlySet<string> = new Set(CONNECT_APPS_FALLBACK);
  return pickConnectLogoIds({
    connected: pick.connected,
    fallback: CONNECT_APPS_FALLBACK,
    drawable: (slug) => bundled.has(slug) || pick.knownLogo(slug) !== "",
    max: pick.max,
  });
}
