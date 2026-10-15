/**
 * Names that resolve to nowhere inside Chromium, root-dot forms included. The
 * fence proxy already refuses them; these rules are the second wall for any
 * lookup Chromium makes itself. The "any address" forms reach this machine on
 * macOS and Linux, and `.internal` / `metadata` name a cloud's metadata server
 * and cluster services.
 */
const UNRESOLVABLE = [
  "0.0.0.0",
  "::",
  "metadata",
  "metadata.",
  "*.internal",
  "*.internal.",
];

/**
 * The network fence's Chromium flags. EVERY request goes to the fence proxy
 * (fence-proxy.ts), which resolves the host itself and refuses non-public
 * answers: subresources, scripts' fetches, workers and each hop of a redirect,
 * which a Playwright route never sees. The bypass list holds only
 * `<-loopback>`, which REMOVES Chromium's built-in loopback bypass, so
 * 127.0.0.1 and localhost reach the proxy too (and are refused). WebRTC never
 * uses a proxy, so its non-proxied UDP is off.
 */
export function networkFenceArgs(proxyPort: number): string[] {
  return [
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
    `--host-resolver-rules=${UNRESOLVABLE.map((host) => `MAP ${host} ~NOTFOUND`).join(", ")}`,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
}
