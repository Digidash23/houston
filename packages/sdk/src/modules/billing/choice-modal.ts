import type { BillingChoice } from "@houston/wire-types";
import {
  type ChoiceContext,
  type ChoiceNotice,
  choiceNotice,
} from "./choice-model";

/** The notices the pricing-change modal announces. */
export type AnnouncedChoice = Extract<
  ChoiceNotice,
  { kind: "pick" | "single_org" | "member" }
>;

export interface ChoiceModalContext extends ChoiceContext {
  /** The person chose "Maybe later" since the app last opened. */
  laterThisSession: boolean;
  /**
   * A plan dialog (`planDialog`) is showing, or the plan it depends on is
   * still loading. The modal never stacks on one: it waits until it is gone.
   */
  otherDialogOpen: boolean;
}

/**
 * Whether the pricing-change modal shows when the app opens, and what closing
 * it does. `session`: an owner who still has to pick sees it on every app
 * open until they do, so closing only hides it until the app next opens.
 * `everywhere`: a read-only notice, shown once; closing stores the dismissal
 * on the server (`dismissChoiceNotice`) so no device shows it again.
 */
export type ChoiceModal =
  | { open: false }
  | { open: true; notice: AnnouncedChoice; close: "session" | "everywhere" };

export function choiceModal(
  choice: BillingChoice | null | undefined,
  context: ChoiceModalContext,
): ChoiceModal {
  const notice = choiceNotice(choice, context);
  if (context.otherDialogOpen) return { open: false };
  switch (notice.kind) {
    case "pick":
      return context.laterThisSession
        ? { open: false }
        : { open: true, notice, close: "session" };
    case "single_org":
    case "member":
      return { open: true, notice, close: "everywhere" };
    default:
      return { open: false };
  }
}
