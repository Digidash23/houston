import i18n from "../lib/i18n";
import { tellOptimisticRefusal } from "../lib/optimistic-write";

/** The sidebar snapped back to its last saved arrangement: say it did not
 *  save, unless `call()` already explained the refusal (offline, waking). */
export function tellSidebarLayoutRefused(err: unknown): void {
  tellOptimisticRefusal("sidebar_layout_write", err, {
    title: i18n.t("shell:sidebar.layoutSaveFailed.title"),
    description: i18n.t("shell:sidebar.layoutSaveFailed.description"),
  });
}
