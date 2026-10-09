import type { Browser, LaunchOptions } from "playwright-core";
import { BrowserToolError } from "./errors";

/** One way to get a Chromium-family browser, tried in order. */
export interface LaunchCandidate {
  label: string;
  options: LaunchOptions;
}

type BrowserEnv = Record<string, string | undefined>;

/** `--disable-dev-shm-usage` always (containers ship a 64 MB /dev/shm), plus extras. */
export function launchArgs(env: BrowserEnv): string[] {
  const extra = (env.HOUSTON_BROWSER_ARGS ?? "").split(/\s+/).filter(Boolean);
  return ["--disable-dev-shm-usage", ...extra];
}

/**
 * Where a browser can come from, most deliberate first:
 * 1. `HOUSTON_BROWSER_EXECUTABLE`: what a cloud image bakes (the headless
 *    shell, ~440 MB PSS on a 2 GB sandbox where full Chrome took ~1.2 GB).
 * 2. Playwright's own chromium headless shell, when it was installed.
 * 3. The person's installed Chrome, then Edge (desktop).
 */
export function launchCandidates(env: BrowserEnv): LaunchCandidate[] {
  const base = { headless: true, args: launchArgs(env) };
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
): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const failures: string[] = [];
  for (const candidate of launchCandidates(env)) {
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
