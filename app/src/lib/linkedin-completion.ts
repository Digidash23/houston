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
  /** Who is signed in now (the session's user id), or null. */
  identity: () => string | null;
  complete: (ticket: string) => Promise<LinkedInCompletion>;
  landed: (connection: LinkedInConnection) => void;
  tell: (result: LinkedInCompletionResult) => void;
}

/**
 * A failed redemption already reported through the facade: nothing to tell.
 * An answer that comes back to someone else (signed out, or another account
 * signed in, while it was out) is dropped: it would put one person's LinkedIn
 * in the cache the next person's share dialog reads.
 */
export async function redeemLinkedIn(
  pending: SlackCompletion,
  ports: LinkedInCompletionPorts,
): Promise<void> {
  if (pending.kind === "invalid") return ports.tell("unredeemable");
  const startedAs = ports.identity();
  let result: LinkedInCompletion;
  try {
    result = await ports.complete(pending.ticket);
  } catch {
    return;
  }
  if (startedAs === null || ports.identity() !== startedAs) return;
  if (result.kind === "invalid") return ports.tell("unredeemable");
  ports.landed(result.connection);
  ports.tell("connected");
}
