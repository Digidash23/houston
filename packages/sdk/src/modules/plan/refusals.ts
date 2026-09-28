import { refusalCode, refusalStatus } from "../refusal-code";

/**
 * The C19 refusals a Plus checkout answers for a state the person is in, not a
 * failure: the plan is already Plus, the account is being deleted, or the plan
 * is switched off on this gateway. Each code is recognized only with the status
 * the contract pairs it with, so an unrelated error that happens to carry the
 * same word stays a bug.
 */
const CHECKOUT_REFUSALS = {
  already_plus: 409,
  account_deleted: 410,
  not_configured: 503,
} as const;

export type PlusCheckoutRefusal = keyof typeof CHECKOUT_REFUSALS;

/**
 * The refusal behind a failed `POST /v1/me/plus/checkout`, or null for every
 * other error. Reads the adapter's parsed `body`, a raw text `body`, or the
 * SDK's own error, whose message is the response text.
 */
export function plusCheckoutRefusal(
  error: unknown,
): PlusCheckoutRefusal | null {
  if (!(error instanceof Error)) return null;
  const status = refusalStatus(error);
  if (status === null) return null;
  const code = refusalCode(error);
  if (code === null || !Object.hasOwn(CHECKOUT_REFUSALS, code)) return null;
  const refusal = code as PlusCheckoutRefusal;
  return CHECKOUT_REFUSALS[refusal] === status ? refusal : null;
}
