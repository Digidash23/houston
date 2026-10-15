import type { BackupBrowser } from "./kernel-tab";
import type { BrowserTab } from "./open-tab";
import { disposeSlot, liveTab, type Slot } from "./pool-slot";
import { closeContext } from "./tab-pages";

/**
 * How a running call moves its conversation between the local browser and
 * the backup one. Only used from inside the slot's own queued call, so no
 * other call sees the slot mid-move.
 */
export interface TabSwap {
  /** Open a backup tab for `host`, kept aside until adopted; null when the fallback is off. */
  readonly openBackup: ((host: string) => Promise<BrowserTab>) | null;
  /**
   * Make `tab` the conversation's tab. The one it replaces is closed unsaved:
   * its last visit was the blocked one (open-fallback.ts).
   */
  adopt(tab: BrowserTab): Promise<void>;
  /** Close the backup tab being tried, unsaved: it never became the conversation's. */
  dropBackup(): Promise<void>;
  /** Save and close the current tab, and open a local one in its place. */
  reopenLocal(): Promise<BrowserTab>;
}

export function slotSwap(
  slot: Slot,
  backup: BackupBrowser | null,
  openLocal: (statePath: string) => Promise<BrowserTab>,
  maxPages: number,
): TabSwap {
  return {
    openBackup: backup
      ? (host) => {
          const opening = backup.open(slot.statePath, maxPages, host);
          slot.spare = opening;
          return opening;
        }
      : null,
    async adopt(tab) {
      const replaced = slot.tab;
      slot.tab = Promise.resolve(tab);
      slot.spare = null;
      const old = await replaced?.catch(() => undefined);
      if (old && old !== tab) await closeContext(old);
    },
    async dropBackup() {
      const spare = slot.spare;
      slot.spare = null;
      const tab = await spare?.catch(() => undefined);
      if (tab) await closeContext(tab);
    },
    async reopenLocal() {
      await disposeSlot(slot);
      return liveTab(slot, openLocal);
    },
  };
}
