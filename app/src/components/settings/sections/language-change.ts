import type { SupportedLocale } from "../../../lib/i18n";
import type { LocaleWriteOutcome } from "../../../stores/workspace-locale-writes";

export interface LanguageChangeDeps {
  /** The language on screen now. */
  shown: () => SupportedLocale;
  show: (locale: SupportedLocale) => Promise<void>;
  /** The switch landed on screen: analytics + the confirmation toast. */
  announce: (locale: SupportedLocale) => void;
  save: (
    workspaceId: string,
    locale: SupportedLocale,
  ) => Promise<LocaleWriteOutcome>;
  /** The workspace's own choice after the store's rollback, if it has one. */
  restored: (workspaceId: string) => SupportedLocale | null;
  refused: (err: unknown) => void;
}

/**
 * The Language picker's change: the language switches at once and the
 * override saves behind it. Only the newest pick's refusal reaches here (the
 * store resolves older ones `superseded`); it puts back the workspace's
 * restored choice, or, for a workspace with none, the language shown before
 * this run of picks started, and says the change did not stick.
 */
export function createLanguageChange(deps: LanguageChangeDeps) {
  let pending = 0;
  let baseline = deps.shown();
  return async (workspaceId: string, value: SupportedLocale): Promise<void> => {
    if (pending === 0) baseline = deps.shown();
    pending++;
    // Observed now, so the switch below can never leave it unhandled.
    const saved = deps.save(workspaceId, value).then(
      () => null,
      (err: unknown) => ({ err }),
    );
    void saved.then(() => {
      pending--;
    });
    await deps.show(value);
    deps.announce(value);
    const refused = await saved;
    if (!refused) return;
    await deps.show(deps.restored(workspaceId) ?? baseline);
    deps.refused(refused.err);
  };
}
