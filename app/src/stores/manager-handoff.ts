import { create } from "zustand";

/**
 * A first message for the AI Manager's real chat, sent on the person's
 * behalf the moment that chat opens: the answer they gave (`text`, their
 * bubble) over the instruction the manager reads with it (`context`).
 */
export interface ManagerHandoff {
  text: string;
  context: string;
}

interface ManagerHandoffState {
  pending: ManagerHandoff | null;
  /** Leave the message for the chat that opens next. */
  handOff: (handoff: ManagerHandoff) => void;
  /** The waiting message, taken exactly once. */
  take: () => ManagerHandoff | null;
}

/**
 * The seam between the onboarding conversation, which ends on the person's
 * "Yes, let's do it", and the real chat, which sends it: the chat only mounts
 * once onboarding has handed the view over, so the message waits here for it.
 */
export const useManagerHandoffStore = create<ManagerHandoffState>(
  (set, get) => ({
    pending: null,
    handOff: (handoff) => set({ pending: handoff }),
    take: () => {
      const { pending } = get();
      if (pending !== null) set({ pending: null });
      return pending;
    },
  }),
);
