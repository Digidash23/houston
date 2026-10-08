import { spawn } from "node:child_process";
import { assertBundleBuilt, type BundleName } from "./serve-mode";

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

const child = spawn(
  "vite",
  ["preview", "--outDir", dir, "--port", port, "--strictPort"],
  { stdio: "inherit" },
);
const forward = (signal: NodeJS.Signals) =>
  process.on(signal, () => child.kill(signal));
forward("SIGINT");
forward("SIGTERM");
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on("error", (err) => {
  console.error(`serve-bundle: failed to start vite preview:`, err);
  process.exit(1);
});
