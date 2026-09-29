import gmailIcon from "../../assets/integrations/gmail.svg";
import outlookIcon from "../../assets/integrations/outlook.svg";
import slackIcon from "../../assets/integrations/slack.svg";
import type { CONNECT_APPS_FALLBACK } from "./connect-group-logos";

/**
 * The bundled marks of the apps that fill the connect group's apps row. The
 * row draws them before the integration catalog lands, and on a deployment
 * with no catalog at all, and keeps them once it lands so a logo never swaps
 * its image. Split from `connect-group-logos.ts` because asset imports are
 * Vite-only and the pure module runs under `node --test`.
 */
const BUNDLED_LOGOS = {
  gmail: gmailIcon,
  outlook: outlookIcon,
  slack: slackIcon,
} satisfies Record<(typeof CONNECT_APPS_FALLBACK)[number], string>;

const BY_SLUG: ReadonlyMap<string, string> = new Map(
  Object.entries(BUNDLED_LOGOS),
);

/** The bundled logo URL for one of the apps row's popular apps, or "" for any
 *  other slug. */
export function bundledConnectAppLogo(slug: string): string {
  return BY_SLUG.get(slug) ?? "";
}
