import type { WebhookKeyAccess } from "@houston/sdk";
import type { WebhookActivationState } from "./routine-trigger-maps";

/**
 * What the webhook activation chip renders, from the routine's live state and
 * the viewer's access to its key. Everyone sees whether a webhook exists; the
 * create and rotate actions exist only for the viewer the gateway would
 * accept (`allowed`), and someone it would refuse reads one line naming who
 * can: the routine's creator, or the space owner for a routine naming none.
 * While access is still `unknown` (session or capabilities loading) the chip
 * shows the state with no action and no line, rather than flash either.
 * Pure, so it unit-tests under bare node.
 */
export interface WebhookChipView {
  /** A key exists: show the "Webhook active" state. */
  active: boolean;
  /** No status yet: the checking spinner. */
  checking: boolean;
  /** Something the server reports that needs a person: the alert line. */
  alert: boolean;
  /** Offer "Create webhook address". */
  showCreate: boolean;
  /** Offer "New key". */
  showRotate: boolean;
  /** The line naming who can mint, for a viewer the gateway would refuse. */
  notice: "creator_only" | "owner_only" | null;
}

export function webhookChipView(
  state: WebhookActivationState,
  access: WebhookKeyAccess,
): WebhookChipView {
  const allowed = access === "allowed";
  const keyed = state === "needs_key" || state === "active";
  return {
    active: state === "active",
    checking: state === "checking",
    alert: state === "alert",
    showCreate: state === "needs_key" && allowed,
    showRotate: state === "active" && allowed,
    notice: !keyed
      ? null
      : access === "not_creator"
        ? "creator_only"
        : access === "not_owner"
          ? "owner_only"
          : null,
  };
}
