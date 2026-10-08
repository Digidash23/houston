import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertBundleBuilt, type BundleName, STAMP_FILE } from "./serve-mode";

/**
 * The `bundle` serve mode's web server: `vite preview` over one prebuilt
 * bundle (see serve-mode.ts). Usage: `tsx e2e/support/serve-bundle.ts
 * <shell|sign-in> <port>`, wired as the `webServer` command in
 * playwright.config.ts.
 *
 * A thin wrapper rather than `vite preview` straight from the config so the
 * missing-build check runs when the SERVER starts, not when the config loads:
 * `playwright test --list` (tests/e2e-harness-loads.test.ts runs it in CI,
 * where `bundle` is the default) must work with nothing built. Playwright
 * stops the whole process group when the run ends, so vite goes with us.
 */
const [name, port] = process.argv.slice(2);
if ((name !== "shell" && name !== "sign-in") || !port) {
  console.error("usage: serve-bundle.ts <shell|sign-in> <port>");
  process.exit(2);
}
const dir = assertBundleBuilt(name as BundleName);
warnIfStale(dir);

const child = spawn(
  "vite",
  ["preview", "--outDir", dir, "--port", port, "--strictPort"],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  // Exit the way vite did. Re-raising the signal on ourselves would land in
  // the forwarders above and exit 0; the shell convention is 128 + signo.
  if (signal) process.exit(128 + (os.constants.signals[signal] ?? 0));
  process.exit(code ?? 1);
});
child.on("error", (err) => {
  console.error("serve-bundle: failed to start vite preview:", err);
  process.exit(1);
});

/** A local `HOUSTON_E2E_SERVE=bundle` run against a bundle built on another
 *  commit tests the wrong code without saying so; say so. A warning, not a
 *  refusal: uncommitted edits make the stamp a hint, not a proof. */
function warnIfStale(bundleDir: string): void {
  let built: string;
  let head: string;
  try {
    built = readFileSync(path.join(bundleDir, STAMP_FILE), "utf8").trim();
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return; // no stamp or no git: nothing to compare
  }
  if (built !== head) {
    console.warn(
      `serve-bundle: ${bundleDir} was built at ${built.slice(0, 9)}, HEAD is ${head.slice(0, 9)}. Rebuild with \`pnpm --filter houston-web e2e:build\`.`,
    );
  }
}
