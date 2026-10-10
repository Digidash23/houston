/** Bundle id an offline launch marked ready before it was ever confirmed online. */
export const PROVISIONAL_READY_KEY = "houston.ota.provisional_ready";
/** The mounted app must stay up, crash-free, this long to count as good. */
export const SHELL_SETTLE_MS = 2000;
/** Matches Capgo's `appReadyTimeout`: the web app must at least mount by then. */
export const MOUNT_DEADLINE_MS = 30000;

export interface ReadyPorts {
  root: HTMLElement;
  notifyAppReady(): Promise<unknown>;
  /** Capgo's current bundle; `status` is "success" once confirmed ready. */
  currentBundle(): Promise<{ id: string; status: string }>;
  /** Returns to the store's builtin bundle and reloads. */
  resetToBuiltin(): Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  report(error: unknown): void;
}

export interface ReadyWatch {
  /** The boot itself failed (e.g. the web entry threw while loading). */
  fail(error: unknown): void;
}

type ShellState = "pending" | "mounted" | "crashed";

/** Any mounted UI counts, the boot splash included: a slow network or engine
 *  wake must never roll a healthy bundle back. Only the crash screen fails. */
function shellState(root: HTMLElement): ShellState {
  if (root.querySelector("[data-houston-boot-crashed]")) return "crashed";
  return root.firstElementChild ? "mounted" : "pending";
}

/**
 * Online boot. Start it BEFORE loading the web entry so a bundle whose entry
 * throws is still caught. The bundle is good once the web app has mounted and
 * stayed up without crashing; until then Capgo's `appReadyTimeout` rolls back a
 * fresh bundle that never mounts. A bundle an offline launch marked ready
 * provisionally is already "good" to Capgo, so a crash or a failed mount resets
 * it to the builtin bundle here instead.
 */
export function declareReadyWhenShellRenders(ports: ReadyPorts): ReadyWatch {
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
    if (state === "pending") return;
    settle ??= setTimeout(() => {
      if (shellState(ports.root) === "crashed") return fail("crashed");
      finish();
      ports.storage.removeItem(PROVISIONAL_READY_KEY);
      void ports.notifyAppReady().catch(ports.report);
    }, SHELL_SETTLE_MS);
  };
  const observer = new MutationObserver(evaluate);
  observer.observe(ports.root, { childList: true, subtree: true });
  const deadline = setTimeout(
    () => fail("never mounted the app"),
    MOUNT_DEADLINE_MS,
  );
  evaluate();
  return {
    fail: (error) => {
      fail(
        `failed to boot (${error instanceof Error ? error.message : String(error)})`,
      );
    },
  };
}

async function rollBackProvisional(
  ports: ReadyPorts,
  bundleId: string,
  reason: string,
): Promise<void> {
  try {
    ports.storage.removeItem(PROVISIONAL_READY_KEY);
    if ((await ports.currentBundle()).id !== bundleId) return;
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
 * update). A bundle not yet confirmed online is remembered as provisional until
 * an online launch mounts the app; a confirmed bundle is never put on trial.
 * Resolves once the marker is recorded; `notifyAppReady` runs on its own and
 * reports, so a hanging native call never holds up the online launch.
 */
export async function declareProvisionalReady(
  ports: ReadyPorts,
): Promise<void> {
  const bundle = await ports.currentBundle();
  const confirmed =
    bundle.status === "success" &&
    ports.storage.getItem(PROVISIONAL_READY_KEY) !== bundle.id;
  if (bundle.id !== "builtin" && !confirmed)
    ports.storage.setItem(PROVISIONAL_READY_KEY, bundle.id);
  void ports.notifyAppReady().catch(ports.report);
}
