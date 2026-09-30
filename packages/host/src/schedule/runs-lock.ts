/**
 * Per-agent serialization of routine_runs.json read-modify-writes.
 *
 * Every writer (fire, cancel, reconcile) rewrites the WHOLE file from a
 * snapshot it loaded — so two writers whose loads both resolve before either
 * save lands silently overwrite each other: a double-fired run, a resurrected
 * cancel, a dropped run row. Queuing per agent root makes each load see the
 * previous save within this process. Replicas arbitrate separately (the
 * scheduler's per-instant setNx, reconcile's per-run setNx).
 *
 * Hold the queue only around the load→save section — never across a turn POST
 * or a runtime cold start, so a slow fire can't block a cancel.
 */

import type { LocalWriteLock } from "@houston/runtime-client/object-sync";

const queues = new Map<string, Promise<void>>();

export function withRunsFile<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = queues.get(root) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(root, tail);
  void tail.then(() => {
    if (queues.get(root) === tail) queues.delete(root);
  });
  return run;
}

const RUNS_FILE = "/.houston/routine_runs/routine_runs.json";

/**
 * The runs queue as the store-sync daemon holds it while a merge rewrites an
 * agent's run history (synced paths are `<workspacesDir>/<Workspace>/<Agent>/…`,
 * and a local agent's root IS `<Workspace>/<Agent>`). Without it a fire,
 * cancel or reconcile whose load→save spans the rewrite would save over the
 * merged rows. Every other path passes straight through.
 */
export function storeSyncRunsLock(workspacesDir: string): LocalWriteLock {
  const prefix = `${workspacesDir}/`;
  return (relativePath, write) =>
    relativePath.startsWith(prefix) && relativePath.endsWith(RUNS_FILE)
      ? withRunsFile(
          relativePath.slice(prefix.length, -RUNS_FILE.length),
          write,
        )
      : write();
}
