import type { Workspace } from "../lib/types";

/**
 * `saved`: this was the newest choice and the host kept it. `superseded`: a
 * later choice for the same workspace owns the outcome, so this one changes
 * nothing visible either way.
 */
export type LocaleWriteOutcome = "saved" | "superseded";

export interface LocaleWriteDeps {
  /** The workspace's locale as the store shows it now. */
  read: (id: string) => string | null | undefined;
  swap: (id: string, next: (w: Workspace) => Workspace) => void;
  write: (id: string, locale: string | null) => Promise<Workspace>;
}

interface Run {
  issued: number;
  pending: number;
  /** The newest locale the host acknowledged (or the one shown before the run). */
  confirmed: string | null | undefined;
  confirmedSeq: number;
  newestRefused: boolean;
}

/**
 * Optimistic workspace-locale writes, one sequence per workspace. A person can
 * pick twice before the first save answers; only the NEWEST pick may swap the
 * host's record in or roll back, and a rollback lands on the newest locale the
 * host acknowledged, never a click-time guess an earlier save already replaced.
 * The newest refusal rejects (its caller tells the person); an older one
 * resolves `superseded`, its error already surfaced by `call()`.
 */
export function workspaceLocaleWrites(deps: LocaleWriteDeps) {
  const runs = new Map<string, Run>();
  return async (
    id: string,
    locale: string | null,
  ): Promise<LocaleWriteOutcome> => {
    const run: Run = runs.get(id) ?? {
      issued: 0,
      pending: 0,
      confirmed: deps.read(id),
      confirmedSeq: 0,
      newestRefused: false,
    };
    runs.set(id, run);
    const seq = ++run.issued;
    run.pending++;
    run.newestRefused = false;
    deps.swap(id, (w) => ({ ...w, locale }));
    try {
      const updated = await deps.write(id, locale);
      if (seq > run.confirmedSeq) {
        run.confirmedSeq = seq;
        run.confirmed = updated.locale;
        // The newest pick, or the newest the host kept after it refused a later one.
        if (seq === run.issued || run.newestRefused)
          deps.swap(id, () => updated);
      }
      return seq === run.issued ? "saved" : "superseded";
    } catch (err) {
      if (seq !== run.issued) return "superseded";
      run.newestRefused = true;
      deps.swap(id, (w) => ({ ...w, locale: run.confirmed }));
      throw err;
    } finally {
      if (--run.pending === 0) runs.delete(id);
    }
  };
}
