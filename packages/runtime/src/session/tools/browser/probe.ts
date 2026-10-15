import { FENCE_HEADER } from "./fence-wire";
import { launchBrowser } from "./launch";

/**
 * `HOUSTON_SIDECAR_ROLE=browser-probe` (scripts/smoke-sidecar-browser.sh):
 * start the browser exactly as the tool does, fence proxy included, render a
 * page, and check the fence refuses this machine. A packaged build whose
 * bundled playwright-core cannot find its own files fails here, not on a
 * person's first browser call.
 */
export async function runBrowserProbe(): Promise<void> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent("<p id=probe>ok</p>");
    const text = await page.textContent("#probe");
    const local = await page.goto("http://localhost/");
    const fence = local?.headers()[FENCE_HEADER] ?? "none";
    if (text !== "ok" || fence !== "refused")
      throw new Error(`browser probe failed: page=${text} fence=${fence}`);
    console.log(`HOUSTON_BROWSER_PROBE ok fence=${fence}`);
  } finally {
    await browser.close();
  }
}
