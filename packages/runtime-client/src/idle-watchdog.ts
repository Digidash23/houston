/**
 * The idle watchdog both long-lived stream loops run (`streamGlobalEvents`,
 * `streamEventsResumable`): it force-reconnects a connection that has received
 * no bytes for `idleTimeoutMs`, because silence past the server's 15s
 * heartbeat means a half-open socket that would otherwise leave `read()`
 * pending forever.
 *
 * Silence is counted only while the page is actually running. A hidden page
 * (a backgrounded desktop window, a browser tab out of view) is woken by the
 * OS once a minute or less often, and at each wake its timers may run BEFORE
 * the heartbeat bytes the network queued while it slept. Judging the stream
 * on that wall-clock gap tears a healthy connection down at every wake: one
 * staging client's stream lived 60 s, sat closed for 60 s and reopened, all
 * day, and each reopen re-read every screen (and woke the agents behind them).
 *
 * So a sweep that fires well past its schedule proves only that the page
 * slept: it restarts the silence clock instead of judging. A socket that
 * really died is still caught one full `idleTimeoutMs` after the page runs on
 * time again, or sooner through the loop's `wake` signals (window visible,
 * network back).
 *
 * Idle detection is a timestamp plus one coarse sweep, never a timer re-arm
 * per delivered chunk. The sweep scales down with small (test) timeouts so the
 * watchdog stays meaningful there too.
 */

export interface IdleWatchdogOptions {
  idleTimeoutMs: number;
  /** Clock for silence and sweep lateness. */
  now: () => number;
  /** The connection has been silent past `idleTimeoutMs` while running. */
  onStall: () => void;
}

export interface IdleWatchdog {
  /** Bytes arrived. */
  touch(): void;
  /** Wall-clock time since the last bytes (or since the watchdog started). */
  silentMs(): number;
  /** Stop sweeping. Idempotent. */
  stop(): void;
}

export function startIdleWatchdog(opts: IdleWatchdogOptions): IdleWatchdog {
  const { idleTimeoutMs, now, onStall } = opts;
  const sweepMs = Math.min(5_000, Math.max(20, Math.ceil(idleTimeoutMs / 4)));
  // A sweep this far past the previous one was held by the page, not run late
  // by a busy moment: twice the sweep is well above ordinary timer slack and
  // well below any idle timeout worth having.
  const lateMs = 2 * sweepMs;
  // Starts now, so a connect that never answers is caught too.
  let lastActivity = now();
  /** When silence started counting: the last bytes, or the last wake. */
  let countingSince = lastActivity;
  let lastSweep = lastActivity;
  const timer = setInterval(() => {
    const at = now();
    const slept = at - lastSweep > lateMs;
    lastSweep = at;
    if (slept) {
      countingSince = at;
      return;
    }
    if (at - Math.max(lastActivity, countingSince) > idleTimeoutMs) onStall();
  }, sweepMs);

  return {
    touch: () => {
      lastActivity = now();
    },
    silentMs: () => now() - lastActivity,
    stop: () => clearInterval(timer),
  };
}
