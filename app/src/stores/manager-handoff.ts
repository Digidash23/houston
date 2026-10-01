import { create } from "zustand";

/**
 * The kickoff of the AI Manager's real chat, sent on the person's behalf the
 * moment that chat opens: `text` is what the chat shows for it (the goal
 * card), `context` the instructions only the model reads.
 */
export interface ManagerHandoff {
  text: string;
  context: string;
  grants: ["createAgent"];
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
 * goal, and the real chat, which sends it: the chat only mounts
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
