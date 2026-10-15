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

/**
 * The call was abandoned at its deadline (action-deadline.ts) while it kept
 * running; the calls queued after it own the slot now.
 */
export class SlotAbandoned extends Error {
  override readonly name = "SlotAbandoned";
}

export function slotSwap(
  slot: Slot,
  backup: BackupBrowser | null,
  openLocal: (statePath: string) => Promise<BrowserTab>,
  maxPages: number,
): TabSwap {
  const epoch = slot.epoch;
  const ensureOwned = () => {
    if (slot.epoch !== epoch) throw new SlotAbandoned();
  };
  // This call's own backup tab: the slot's `spare` is only where an abandon
  // finds it, and may by then be a later call's.
  let spare: Promise<BrowserTab> | null = null;
  const release = () => {
    if (slot.spare === spare) slot.spare = null;
    spare = null;
  };
  return {
    openBackup: backup
      ? (host) => {
          ensureOwned();
          const opening = backup.open(slot.statePath, maxPages, host);
          spare = opening;
          slot.spare = opening;
          return opening;
        }
      : null,
    async adopt(tab) {
      // Abandoned: the tab stays this call's spare, for dropBackup to close.
      ensureOwned();
      const replaced = slot.tab;
      slot.tab = Promise.resolve(tab);
      release();
      const old = await replaced?.catch(() => undefined);
      if (old && old !== tab) await closeContext(old);
    },
    async dropBackup() {
      const mine = spare;
      release();
      const tab = await mine?.catch(() => undefined);
      if (tab) await closeContext(tab);
    },
    async reopenLocal() {
      ensureOwned();
      await disposeSlot(slot);
      ensureOwned();
      return liveTab(slot, openLocal);
    },
  };
}
