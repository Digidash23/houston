import type { Browser, LaunchOptions } from "playwright-core";
import { BrowserToolError } from "./errors";

/** One way to get a Chromium-family browser, tried in order. */
export interface LaunchCandidate {
  label: string;
  options: LaunchOptions;
}

type BrowserEnv = Record<string, string | undefined>;

/**
 * Names that resolve to nowhere inside the browser. The "any address" forms
 * reach this machine on macOS and Linux, and `.internal` / `metadata` name a
 * cloud's metadata server and cluster services.
 */
const UNRESOLVABLE = ["0.0.0.0", "::", "metadata", "*.internal"];

/**
 * The network fence, enforced by Chromium on EVERY request: subresources,
 * fetches from page scripts, workers, and each hop of a redirect, which a
 * Playwright route never sees. All traffic bypasses the proxy (`*`) except
 * what `<-loopback>` takes back out (127/8, ::1, localhost, *.localhost,
 * 169.254/16, fe80::/10), which goes to a proxy that refuses the connection.
 * NOT covered: a public name whose DNS answer is loopback.
 */
export function networkFenceArgs(extraHostRules: readonly string[] = []) {
  const rules = [
    ...extraHostRules,
    ...UNRESOLVABLE.map((host) => `MAP ${host} ~NOTFOUND`),
  ];
  return [
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=*;<-loopback>",
    `--host-resolver-rules=${rules.join(", ")}`,
  ];
}

/**
 * The fence, `--disable-dev-shm-usage` (containers ship a 64 MB /dev/shm),
 * then the operator's extras. `extraHostRules` is the tests' seam for naming
 * a local fixture server.
 */
export function launchArgs(
  env: BrowserEnv,
  extraHostRules: readonly string[] = [],
): string[] {
  const extra = (env.HOUSTON_BROWSER_ARGS ?? "").split(/\s+/).filter(Boolean);
  return [
    ...networkFenceArgs(extraHostRules),
    "--disable-dev-shm-usage",
    ...extra,
  ];
}

/**
 * Where a browser can come from, most deliberate first:
 * 1. `HOUSTON_BROWSER_EXECUTABLE`: what a cloud image bakes (the headless
 *    shell, ~440 MB PSS on a 2 GB sandbox where full Chrome took ~1.2 GB).
 * 2. Playwright's own chromium headless shell, when it was installed.
 * 3. The person's installed Chrome, then Edge (desktop).
 */
export function launchCandidates(
  env: BrowserEnv,
  extraHostRules: readonly string[] = [],
): LaunchCandidate[] {
  const base = { headless: true, args: launchArgs(env, extraHostRules) };
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

/**
 * Launch the first candidate that starts. `playwright-core` loads here, on the
 * first browser call, so a runtime that never browses never pays for it.
 */
export async function launchBrowser(
  env: BrowserEnv = process.env,
  extraHostRules: readonly string[] = [],
): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const failures: string[] = [];
  for (const candidate of launchCandidates(env, extraHostRules)) {
    try {
      const browser = await chromium.launch(candidate.options);
      console.info(`[browser] launched ${candidate.label}`);
      return browser;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.label}: ${reason.split("\n")[0]}`);
    }
  }
  console.warn(`[browser] no browser could start\n${failures.join("\n")}`);
  throw new BrowserToolError("browser_unavailable", NO_BROWSER_MESSAGE);
}
