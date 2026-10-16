/**
 * Where a LinkedIn connect returns to, by the shell it starts in. Pure.
 *
 * - `desktop`: the Tauri app binds a loopback listener (falling back to the
 *   `houston://` deep link) and opens the system browser.
 * - `mobileApp`: the iOS or Android app opens LinkedIn in an in-app browser
 *   that holds no Houston session, so the approval must come back to the app
 *   itself through the `houston://` deep link, never to the web app.
 * - `web`: a browser tab claimed in the click, which LinkedIn sends back to
 *   the web app.
 */
export type LinkedInConnectSurface = "desktop" | "mobileApp" | "web";

export function linkedInConnectSurface(env: {
  tauri: boolean;
  nativeMobile: boolean;
}): LinkedInConnectSurface {
  if (env.tauri) return "desktop";
  return env.nativeMobile ? "mobileApp" : "web";
}
