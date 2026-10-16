import {
  type SlackCompletion,
  settingsLandingFromDeepLink,
} from "@houston/app/lib/settings-landing";
import { APP_LINK_PATHS } from "../../web/src/app-association";

/**
 * Where a link that opened the app goes:
 * - `home`: one of the app's public https links.
 * - `linkedin`: a LinkedIn connect's return,
 *   `houston://settings/linkedin?linkedin=<ticket>`, carrying the one-time
 *   ticket the signed-in app redeems. It is the only `houston://` link the
 *   app takes: a connect started here asks the gateway for this return.
 */
export type AppLinkTarget =
  | { kind: "home" }
  | { kind: "linkedin"; completion: SlackCompletion };

export function appLinkTarget(value: string): AppLinkTarget | null {
  if (value.startsWith("houston:")) {
    const landing = settingsLandingFromDeepLink(value);
    return landing.kind === "linkedin"
      ? { kind: "linkedin", completion: landing.completion }
      : null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "app.gethouston.ai" ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    if (
      !APP_LINK_PATHS.includes(url.pathname as (typeof APP_LINK_PATHS)[number])
    )
      return null;
    return { kind: "home" };
  } catch {
    return null;
  }
}
