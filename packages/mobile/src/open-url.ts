/** Schemes the OS hands to its own app (Mail, Phone, Messages). */
const SYSTEM_SCHEMES = new Set(["mailto:", "tel:", "sms:"]);

export type OpenUrlPorts = {
  /** In-app browser; iOS SFSafariViewController only accepts http(s). */
  browser(url: string): Promise<void>;
  /** Capacitor's WebView delegates non-web navigations to the OS on both platforms. */
  system(url: string): void;
};

export async function openExternalUrl(
  raw: string,
  base: string,
  ports: OpenUrlPorts,
): Promise<boolean> {
  const url = new URL(raw, base);
  if (url.protocol === "https:" || url.protocol === "http:") {
    await ports.browser(url.href);
    return true;
  }
  if (SYSTEM_SCHEMES.has(url.protocol)) {
    ports.system(url.href);
    return true;
  }
  throw new Error(`Refusing to open unsupported URL scheme ${url.protocol}`);
}
