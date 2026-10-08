import { spawn } from "node:child_process";
import { AUTH_WEB_PORT, FAKE_FIREBASE_API_KEY, WEB_PORT } from "../config";
import { type BundleName, bundleDir } from "./serve-mode";

/**
 * Build the two web bundles the `bundle` serve mode serves (serve-mode.ts).
 *
 * DEVELOPMENT-mode builds, on purpose. `NODE_ENV=development vite build` keeps
 * every `import.meta.env.DEV` branch, the React dev runtime with its console
 * warnings, and the dev-only test hooks exactly as the dev server has them, so
 * a spec behaves the same under either serve mode. The suite leans on three of
 * those today: `__HOUSTON_UPDATE_PREVIEW__` (update-pill.spec; tree-shaken out
 * of a production build), React's dev-only warnings (skills-react-clean.spec
 * asserts there are none, which a production bundle would pass vacuously), and
 * Sentry's dev suppression in error-toast.ts. `--mode development` matches the
 * dev server's env files and `__APP_VERSION__` suffix too.
 *
 * Unminified, no sourcemaps: nothing serves these beyond localhost, and a
 * readable stack in a failing trace is worth more than a smaller file. The two
 * builds run concurrently; rollup is single-threaded and the runner has four
 * cores.
 */
interface BundleSpec {
  name: BundleName;
  port: number;
  firebaseApiKey: string;
}

const BUNDLES: readonly BundleSpec[] = [
  { name: "shell", port: WEB_PORT, firebaseApiKey: "" },
  {
    name: "sign-in",
    port: AUTH_WEB_PORT,
    firebaseApiKey: FAKE_FIREBASE_API_KEY,
  },
];

function build(spec: BundleSpec): Promise<void> {
  const outDir = bundleDir(spec.name);
  const args = [
    "build",
    "--mode",
    "development",
    "--minify",
    "false",
    "--sourcemap",
    "false",
    "--outDir",
    outDir,
    "--emptyOutDir",
  ];
  return new Promise((resolve, reject) => {
    // `vite` resolves from node_modules/.bin because this runs under `pnpm run`.
    // The identity key is the one define that differs between the servers
    // (vite.config.ts bakes FIREBASE_API_KEY); HOUSTON_E2E_WEB_PORT keeps the
    // per-port vite cacheDir split the dev servers use.
    const child = spawn("vite", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        HOUSTON_E2E_WEB_PORT: String(spec.port),
        FIREBASE_API_KEY: spec.firebaseApiKey,
      },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`vite build (${spec.name}) exited with ${signal ?? code}`),
        );
    });
  });
}

async function main(): Promise<void> {
  const started = Date.now();
  await Promise.all(BUNDLES.map(build));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `e2e bundles built in ${seconds}s: ${BUNDLES.map((b) => bundleDir(b.name)).join(", ")}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
