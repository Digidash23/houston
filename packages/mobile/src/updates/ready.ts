/** Bundle id an offline launch marked ready before it ever reached the app. */
export const PROVISIONAL_READY_KEY = "houston.ota.provisional_ready";
/** The real shell must stay up this long before the bundle counts as good. */
export const SHELL_SETTLE_MS = 2000;
/** Matches Capgo's `appReadyTimeout`: a provisional bundle gets the same window. */
export const PROVISIONAL_RENDER_DEADLINE_MS = 30000;

export interface ReadyPorts {
  root: HTMLElement;
  notifyAppReady(): Promise<unknown>;
  currentBundleId(): Promise<string>;
  /** Returns to the store's builtin bundle and reloads. */
  resetToBuiltin(): Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  report(error: unknown): void;
}

type ShellState = "pending" | "healthy" | "crashed";

/** The boot splash and an empty root are not the app; the crash screen is a failure. */
function shellState(root: HTMLElement): ShellState {
  if (root.querySelector("[data-houston-boot-crashed]")) return "crashed";
  if (
    !root.firstElementChild ||
    root.querySelector("[data-houston-boot-loading]")
  )
    return "pending";
  return "healthy";
}

/**
 * Online boot: declare the OTA bundle good only once the real app (sign-in
 * screen or signed-in shell) has rendered and stayed up. Until then Capgo's
 * `appReadyTimeout` rolls a bundle back that never gets there. A bundle that
 * an offline launch marked ready provisionally is reset here instead, because
 * Capgo already considers it good.
 */
export function declareReadyWhenShellRenders(ports: ReadyPorts): () => void {
  const provisional = ports.storage.getItem(PROVISIONAL_READY_KEY);
  let settle: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const finish = () => {
    done = true;
    observer.disconnect();
    if (settle) clearTimeout(settle);
    clearTimeout(deadline);
  };
  const fail = (reason: string) => {
    if (done) return;
    finish();
    if (provisional !== null)
      void rollBackProvisional(ports, provisional, reason);
  };
  const evaluate = () => {
    if (done) return;
    const state = shellState(ports.root);
    if (state === "crashed") return fail("crashed");
    if (state === "pending") {
      if (settle) clearTimeout(settle);
      settle = null;
      return;
    }
    settle ??= setTimeout(() => {
      if (shellState(ports.root) !== "healthy") return evaluate();
      finish();
      ports.storage.removeItem(PROVISIONAL_READY_KEY);
      void ports.notifyAppReady().catch(ports.report);
    }, SHELL_SETTLE_MS);
  };
  const observer = new MutationObserver(evaluate);
  observer.observe(ports.root, { childList: true, subtree: true });
  const deadline = setTimeout(
    () => fail("did not render the app"),
    PROVISIONAL_RENDER_DEADLINE_MS,
  );
  evaluate();
  return finish;
}

async function rollBackProvisional(
  ports: ReadyPorts,
  bundleId: string,
  reason: string,
): Promise<void> {
  try {
    ports.storage.removeItem(PROVISIONAL_READY_KEY);
    if ((await ports.currentBundleId()) !== bundleId) return;
    ports.report(
      new Error(
        `OTA bundle ${bundleId} ${reason} on its first online launch; resetting to builtin`,
      ),
    );
    await ports.resetToBuiltin();
  } catch (error) {
    ports.report(error);
  }
}

/**
 * Offline launch: the offline screen proves only that the bundle boots, so
 * Capgo is told it is ready (its timeout would otherwise roll back a healthy
 * update) and the bundle is remembered as provisional until an online launch
 * renders the real app.
 */
export async function declareProvisionalReady(
  ports: ReadyPorts,
): Promise<void> {
  const bundleId = await ports.currentBundleId();
  if (bundleId !== "builtin")
    ports.storage.setItem(PROVISIONAL_READY_KEY, bundleId);
  await ports.notifyAppReady();
}
