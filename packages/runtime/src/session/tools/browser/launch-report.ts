/** A launch error that is the sandbox's, not a missing browser's. */
const SANDBOX_FAILURE = /sandbox|namespace|zygote|as root/i;

/** What an operator does about a sandbox that cannot start here. */
const SANDBOX_REMEDY =
  "Chromium's sandbox needs unprivileged user namespaces (Docker's default seccomp profile and some kernels block them) and a non-root user. Allow user namespaces for this process (kernel.unprivileged_userns_clone=1, a seccomp profile that permits clone/unshare of user namespaces), or set HOUSTON_BROWSER_SANDBOX=0 to accept running the browser unsandboxed";

/**
 * The operator-facing line when no browser started. A sandbox failure is an
 * error naming the remedy, and the browser is never retried without it (fail
 * closed); anything else is a warning (desktop: no browser installed).
 */
export function reportNoBrowser(sandboxed: boolean, failures: string[]): void {
  const detail = failures.join("\n");
  if (sandboxed && failures.some((f) => SANDBOX_FAILURE.test(f))) {
    console.error(
      `[browser] Chromium's sandbox could not start, so the browser is off; not retrying without it. ${SANDBOX_REMEDY}.\n${detail}`,
    );
    return;
  }
  console.warn(`[browser] no browser could start\n${detail}`);
}
