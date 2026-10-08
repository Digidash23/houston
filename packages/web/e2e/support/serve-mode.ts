import { existsSync } from "node:fs";
import path from "node:path";

/**
 * How the web app reaches the browser during a run.
 *
 * - `dev`: two `vite` dev servers transform modules on demand. No build step,
 *   HMR, the mode every local run uses.
 * - `bundle`: `vite build` once per server (see build-bundles.ts), then
 *   `vite preview` serves the static output. The dev server is ONE
 *   single-threaded process serving every worker's page boot, and on a 4-vCPU
 *   CI runner that starved concurrent Chromiums past the 10s expect budget
 *   (run 30596416439) and left the signed-in specs flaking on animation
 *   transients at two workers (run 30597930896). A static file server costs
 *   the runner nothing per request, so CI runs several workers per shard.
 *
 * CI defaults to `bundle`; `HOUSTON_E2E_SERVE=bundle` reproduces a CI run
 * locally (build first: `pnpm --filter houston-web e2e:build`).
 */
export type ServeMode = "dev" | "bundle";

export function resolveServeMode(
  env: Record<string, string | undefined> = process.env,
): ServeMode {
  const value = env.HOUSTON_E2E_SERVE;
  if (value === "dev" || value === "bundle") return value;
  if (value) {
    throw new Error(
      `HOUSTON_E2E_SERVE must be "dev" or "bundle", got "${value}"`,
    );
  }
  return env.CI ? "bundle" : "dev";
}

/**
 * One bundle per web server the suite boots. The two differ only in the baked
 * `__FIREBASE_API_KEY__` (a define, so a build-time fact): the identity-off
 * `shell` the whole suite runs on, and the identity-on `sign-in` server behind
 * the `auth` project and the signed-in specs.
 */
export type BundleName = "shell" | "sign-in";
export const BUNDLE_NAMES: readonly BundleName[] = ["shell", "sign-in"];

/** Under the package's `dist/` (gitignored) so `pnpm build` and the e2e
 *  bundles share one ignore rule and one place to clean. */
const BUNDLE_ROOT = path.resolve(import.meta.dirname, "../../dist/e2e");

export function bundleDir(name: BundleName): string {
  return path.join(BUNDLE_ROOT, name);
}

/** Fail at server start (serve-bundle.ts), with the remedy, instead of
 *  letting `vite preview` report a missing directory. Not at config load:
 *  `playwright test --list` runs in CI with nothing built. */
export function assertBundleBuilt(name: BundleName): string {
  const dir = bundleDir(name);
  if (!existsSync(path.join(dir, "index.html"))) {
    throw new Error(
      `HOUSTON_E2E_SERVE=bundle but ${dir} has no build. Run \`pnpm --filter houston-web e2e:build\` first.`,
    );
  }
  return dir;
}
