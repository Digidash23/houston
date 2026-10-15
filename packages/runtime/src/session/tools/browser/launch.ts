import type { Browser, LaunchOptions } from "playwright-core";
import { browserEnv } from "./browser-env";
import { BrowserToolError } from "./errors";
import { type FenceNet, type FenceProxy, startFenceProxy } from "./fence-proxy";
import { bindFence } from "./fence-refusals";
import { privateNetworksFor } from "./ip-ranges";
import { reportNoBrowser } from "./launch-report";
import { networkFenceArgs } from "./network-fence";

/** One way to get a Chromium-family browser, tried in order. */
export interface LaunchCandidate {
  label: string;
  options: LaunchOptions;
}

type BrowserEnv = Record<string, string | undefined>;

/**
 * The fence (its proxy on `fenceProxyPort`), `--disable-dev-shm-usage`
 * (containers ship a 64 MB /dev/shm), then the operator's extras.
 */
export function launchArgs(env: BrowserEnv, fenceProxyPort: number): string[] {
  const extra = (env.HOUSTON_BROWSER_ARGS ?? "").split(/\s+/).filter(Boolean);
  return [
    ...networkFenceArgs(fenceProxyPort),
    "--disable-dev-shm-usage",
    ...extra,
  ];
}

/**
 * Whether Chromium runs its own sandbox: yes, on every platform, unless the
 * operator opts out with `HOUSTON_BROWSER_SANDBOX=0` (logged at each launch).
 * Playwright's default turns it off (`--no-sandbox`), so a renderer exploit
 * would run as this process's user, next to the turn's credentials. A
 * sandboxed launch that fails is NOT retried unsandboxed (see
 * {@link launchBrowser}).
 */
export function wantsChromiumSandbox(env: BrowserEnv): boolean {
  return env.HOUSTON_BROWSER_SANDBOX !== "0";
}

/**
 * Playwright's default flags the browser keeps off: `--disable-popup-blocking`
 * would let a page `window.open` itself a chain of renderers without any
 * click. The model's clicks are real input events, so a popup it opens on
 * purpose (a "Sign in with Google" button) still opens.
 */
export const IGNORED_DEFAULT_ARGS = ["--disable-popup-blocking"];

/**
 * Where a browser can come from, most deliberate first:
 * 1. `HOUSTON_BROWSER_EXECUTABLE`: what a cloud image bakes (the headless
 *    shell, ~440 MB PSS on a 2 GB sandbox where full Chrome took ~1.2 GB).
 * 2. Playwright's own chromium headless shell, when it was installed.
 * 3. The person's installed Chrome, then Edge (desktop).
 */
export function launchCandidates(
  env: BrowserEnv,
  fenceProxyPort: number,
): LaunchCandidate[] {
  const base: LaunchOptions = {
    headless: true,
    args: launchArgs(env, fenceProxyPort),
    env: browserEnv(env),
    chromiumSandbox: wantsChromiumSandbox(env),
    ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
  };
  const exe = env.HOUSTON_BROWSER_EXECUTABLE?.trim();
  return [
    ...(exe
      ? [
          {
            label: `HOUSTON_BROWSER_EXECUTABLE (${exe})`,
            options: { ...base, executablePath: exe },
          },
        ]
      : []),
    { label: "Playwright headless shell", options: base },
    { label: "Google Chrome", options: { ...base, channel: "chrome" } },
    { label: "Microsoft Edge", options: { ...base, channel: "msedge" } },
  ];
}

export const NO_BROWSER_MESSAGE =
  "No web browser is available here, so I cannot open websites. Installing Google Chrome on this computer fixes it.";

/** Houston's cloud: nothing on the person's computer can fix it. */
export const NO_CLOUD_BROWSER_MESSAGE =
  "The web browser is not available right now, so websites cannot be opened. This is on Houston's side: nothing on the person's computer needs to change. Tell them, and carry on without the browser if you can.";

export function noBrowserMessage(env: BrowserEnv): string {
  return env.HOUSTON_MANAGED_CLOUD === "1"
    ? NO_CLOUD_BROWSER_MESSAGE
    : NO_BROWSER_MESSAGE;
}

/**
 * Launch the first candidate that starts, behind its own fence proxy, which
 * closes when the browser goes. `playwright-core` loads here, on the first
 * browser call, so a runtime that never browses never pays for it. `net` is
 * the tests' seam for the proxy's DNS and connects.
 */
export async function launchBrowser(
  env: BrowserEnv = process.env,
  net: FenceNet = {},
): Promise<Browser> {
  const failures: string[] = [];
  let fence: FenceProxy | null = null;
  if (!wantsChromiumSandbox(env))
    console.warn(
      "[browser] Chromium's sandbox is OFF (HOUSTON_BROWSER_SANDBOX=0): a compromised page runs as this process's user",
    );
  try {
    const { chromium } = await import("playwright-core");
    fence = await startFenceProxy(privateNetworksFor(env), net);
    for (const candidate of launchCandidates(env, fence.port)) {
      try {
        const browser = await chromium.launch(candidate.options);
        console.info(`[browser] launched ${candidate.label}`);
        bindFence(browser, fence);
        const closing = fence;
        browser.once("disconnected", () => {
          closing.close().catch((error: unknown) => {
            console.error("[browser] closing the fence proxy failed", error);
          });
        });
        return browser;
      } catch (error) {
        failures.push(`${candidate.label}: ${firstLine(error)}`);
      }
    }
  } catch (error) {
    failures.push(`starting the browser: ${firstLine(error)}`);
  }
  await fence?.close();
  reportNoBrowser(wantsChromiumSandbox(env), failures);
  throw new BrowserToolError("browser_unavailable", noBrowserMessage(env));
}

function firstLine(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.split("\n")[0] ?? reason;
}
