import { APP_LINK_PATHS } from "../../web/src/app-association";

export type AppLinkTarget = "home";

export function appLinkTarget(value: string): AppLinkTarget | null {
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
    return "home";
  } catch {
    return null;
  }
}
