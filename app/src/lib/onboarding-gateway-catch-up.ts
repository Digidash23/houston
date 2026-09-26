// The catch-up flush's rule, apart from the record shape it reads
// (`./onboarding-gateway-record.ts`). Pure, so `app/tests` drives it directly.

import { onboardingPatchFromSurvey } from "./onboarding-gateway-record.ts";
import type { OnboardingSurveyPreference } from "./onboarding-survey.ts";

/**
 * The catch-up flush's decision: whether this mount still owes the gateway a
 * push. A record whose push never landed (offline, pod waking, signed out at
 * the time) is re-sent ONCE per account, so the account store converges without
 * the user answering anything again. WHAT gets sent is not decided here — the
 * flush derives it from the record it is about to stamp, so payload and stamp
 * can never disagree.
 *
 * The "once" is keyed by uid, not by a bare boolean: two accounts can sign in
 * on one machine within a single app session, and the second one's unsynced
 * record must still get its catch-up. `undefined` means nothing has flushed
 * yet — distinct from `null`, which is the signed-out account slot.
 *
 * A record a SAVE is already pushing is owed nothing: without `pendingFlush`
 * the session's first save duplicates its own PUT (it writes the unsynced
 * record to the cache, then flushes it) and burns the latch on nothing.
 */
export function owesGatewayCatchUp(input: {
  survey: OnboardingSurveyPreference | null;
  uid: string | null;
  flushedUid: string | null | undefined;
  /** `updatedAt` of the record whose flush a save already owns, else null. */
  pendingFlush: string | null;
}): boolean {
  const { survey, uid, flushedUid, pendingFlush } = input;
  if (flushedUid !== undefined && flushedUid === uid) return false;
  if (!survey || survey.gatewaySyncedAt !== null) return false;
  if (pendingFlush !== null && pendingFlush === survey.updatedAt) return false;
  return onboardingPatchFromSurvey(survey) !== null;
}
