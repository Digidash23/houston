import { create } from "zustand";

/**
 * A LinkedIn post outlives the org chart page that started it: the gateway
 * finishes it even after the person navigates away. Whether one is out, and
 * the link of one that went up with no dialog open to say so, therefore live
 * here, per space, never in the page: coming back while a post is out still
 * shows Posting (never a second Post button), and a post that landed while
 * the page was gone is said in the next opening.
 */
export interface LinkedInPostSlot {
  posting: boolean;
  /** A post that went up and no open dialog has shown yet. */
  landed: string | null;
}

export const IDLE_LINKEDIN_POST: LinkedInPostSlot = {
  posting: false,
  landed: null,
};

interface LinkedInPostStore {
  slots: Record<string, LinkedInPostSlot>;
  /** Claims the slot; false while a post from this space is already out. */
  start: (key: string) => boolean;
  /** The post went up: held until an open dialog shows it. */
  posted: (key: string, postUrl: string) => void;
  /** The post is over, up or not (a no-op on the link of one that went up). */
  ended: (key: string) => void;
  /** An open dialog showed the landed post. */
  shown: (key: string) => void;
}

export const useLinkedInPosts = create<LinkedInPostStore>((set, get) => {
  const patch = (key: string, next: Partial<LinkedInPostSlot>) =>
    set((s) => ({
      slots: {
        ...s.slots,
        [key]: { ...(s.slots[key] ?? IDLE_LINKEDIN_POST), ...next },
      },
    }));
  return {
    slots: {},
    start: (key) => {
      if (get().slots[key]?.posting) return false;
      patch(key, { posting: true, landed: null });
      return true;
    },
    posted: (key, postUrl) => patch(key, { posting: false, landed: postUrl }),
    ended: (key) => patch(key, { posting: false }),
    shown: (key) => patch(key, { landed: null }),
  };
});

/** The post slot of space `key`. */
export function useLinkedInPostSlot(key: string): LinkedInPostSlot {
  return useLinkedInPosts((s) => s.slots[key] ?? IDLE_LINKEDIN_POST);
}
