import type {
  LinkedInCompletion,
  LinkedInConnection,
} from "@houston/engine-adapter";
import type { SlackCompletion } from "./settings-landing.ts";

/**
 * Redeem the ticket a LinkedIn connect's return landed with, once
 * (`takeSlackCompletion` owns the one-shot rule; a replayed link never
 * reaches the queue). Only this authenticated redemption binds the LinkedIn
 * account to the signed-in person: the share dialog's poll merely notices it.
 * DOM-free, so the order is testable.
 *
 *  - `connected`: the connection lands in the cache the dialog reads.
 *  - `unredeemable`: a mangled link, or a ticket the gateway refused
 *    (unknown, expired, spent, someone else's); connect again.
 */
export type LinkedInCompletionResult = "connected" | "unredeemable";

export interface LinkedInCompletionPorts {
  complete: (ticket: string) => Promise<LinkedInCompletion>;
  landed: (connection: LinkedInConnection) => void;
  tell: (result: LinkedInCompletionResult) => void;
}

/** A failed redemption already reported through the facade: nothing to tell. */
export async function redeemLinkedIn(
  pending: SlackCompletion,
  ports: LinkedInCompletionPorts,
): Promise<void> {
  if (pending.kind === "invalid") return ports.tell("unredeemable");
  let result: LinkedInCompletion;
  try {
    result = await ports.complete(pending.ticket);
  } catch {
    return;
  }
  if (result.kind === "invalid") return ports.tell("unredeemable");
  ports.landed(result.connection);
  ports.tell("connected");
}
