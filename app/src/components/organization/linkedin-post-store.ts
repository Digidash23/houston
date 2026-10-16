import { create } from "zustand";

/**
 * A LinkedIn post outlives the org chart page that started it: the gateway
 * finishes it even after the person navigates away. Whether one is out, and
 * how one settled with no dialog open to say so, therefore live here, never
 * in the page: coming back while a post is out still shows Posting (never a
 * second Post button), and a post that settled while the page was gone is
 * said in the next opening.
 *
 * A slot belongs to the signed-in person in one space
 * ({@link linkedInPostKey}): every account's personal space has the same id.
 * Signing out or in empties every slot ({@link reset}), and a post still out
 * then settles into nothing, through its stale {@link LinkedInPostClaim}.
 */
export interface LinkedInPostSlot {
  posting: boolean;
  /** A post that went up and no open dialog has shown yet. */
  landed: string | null;
  /** A post with no answer in time (it may be up) no open dialog has shown. */
  unconfirmed: boolean;
}

export const IDLE_LINKEDIN_POST: LinkedInPostSlot = {
  posting: false,
  landed: null,
  unconfirmed: false,
};

/** The slot of `uid` (`null`: signed out, a local desktop) in `space`. */
export function linkedInPostKey(uid: string | null, space: string): string {
  return JSON.stringify([uid, space]);
}

/** One post's hold on its slot, void once the identity changes. */
export interface LinkedInPostClaim {
  key: string;
  epoch: number;
}

interface LinkedInPostStore {
  slots: Record<string, LinkedInPostSlot>;
  /** Bumped by every {@link reset}: older claims settle into nothing. */
  epoch: number;
  /** Claims the slot; `null` while a post from it is already out. */
  start: (key: string) => LinkedInPostClaim | null;
  /** Whether `claim` was made by the identity signed in now. */
  holds: (claim: LinkedInPostClaim) => boolean;
  /** The post went up: held until an open dialog shows it. */
  posted: (claim: LinkedInPostClaim, postUrl: string) => void;
  /** No answer in time: held until an open dialog says so. */
  unconfirmed: (claim: LinkedInPostClaim) => void;
  /** The post is over, whatever came of it. */
  ended: (claim: LinkedInPostClaim) => void;
  /** An open dialog said how the post settled. */
  shown: (key: string) => void;
  /** The signed-in identity changed: every slot goes. */
  reset: () => void;
}

export const useLinkedInPosts = create<LinkedInPostStore>((set, get) => {
  const patch = (key: string, next: Partial<LinkedInPostSlot>) =>
    set((s) => ({
      slots: {
        ...s.slots,
        [key]: { ...(s.slots[key] ?? IDLE_LINKEDIN_POST), ...next },
      },
    }));
  const holds = (claim: LinkedInPostClaim) => claim.epoch === get().epoch;
  const settle = (
    claim: LinkedInPostClaim,
    next: Partial<LinkedInPostSlot>,
  ) => {
    if (holds(claim)) patch(claim.key, next);
  };
  return {
    slots: {},
    epoch: 0,
    start: (key) => {
      if (get().slots[key]?.posting) return null;
      patch(key, { posting: true, landed: null, unconfirmed: false });
      return { key, epoch: get().epoch };
    },
    holds,
    posted: (claim, postUrl) =>
      settle(claim, { posting: false, landed: postUrl }),
    unconfirmed: (claim) =>
      settle(claim, { posting: false, unconfirmed: true }),
    ended: (claim) => settle(claim, { posting: false }),
    shown: (key) => patch(key, { landed: null, unconfirmed: false }),
    reset: () => set((s) => ({ slots: {}, epoch: s.epoch + 1 })),
  };
});

/** The post slot at `key` ({@link linkedInPostKey}). */
export function useLinkedInPostSlot(key: string): LinkedInPostSlot {
  return useLinkedInPosts((s) => s.slots[key] ?? IDLE_LINKEDIN_POST);
}
