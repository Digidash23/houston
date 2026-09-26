// The onboarding survey as the GATEWAY stores it, and the rules for folding
// that copy into the device's preference record. Pure — no transport, no
// window — so `app/tests` drives it directly; the HTTP client that speaks this
// shape (and the front door consumers import) is `./onboarding-sync.ts`.

import {
  ONBOARDING_ANSWER_SOMETHING_ELSE,
  type OnboardingRecordWire,
} from "@houston/wire-types";
import { normalizeOnboardingIndustryChoice } from "./onboarding-industry.ts";
import {
  createOnboardingSurveyPreference,
  isOnboardingCompanySizeChoice,
  isOnboardingIndustryChoice,
  isOnboardingRoleChoice,
  isValidAutomationGoal,
  normalizeOnboardingCompanySizeChoice,
  normalizeOnboardingRoleChoice,
  type OnboardingCompanySizeChoice,
  type OnboardingIndustryChoice,
  type OnboardingRoleChoice,
  type OnboardingSurveyPreference,
  sameSurveyAnswers,
} from "./onboarding-survey.ts";

/** The gateway's answer shape (`@houston/wire-types`), each id already read
 *  into this build's vocabulary by {@link parseGatewayOnboarding}. */
export type GatewayOnboardingRecord = OnboardingRecordWire;

/** A PUT body this app sends: any non-empty subset of the answer fields. The
 *  retired department (`segment`) is never among them. */
export interface OnboardingSyncPatch {
  role?: OnboardingRoleChoice;
  industry?: OnboardingIndustryChoice;
  companySize?: OnboardingCompanySizeChoice;
  automationGoal?: string;
  goalSkipped?: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Field-by-field, so one unrecognized id costs only that field. */
export function parseGatewayOnboarding(
  value: unknown,
): GatewayOnboardingRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    segment: asString(raw.segment),
    role: normalizeOnboardingRoleChoice(raw.role),
    industry: normalizeOnboardingIndustryChoice(raw.industry),
    companySize: normalizeOnboardingCompanySizeChoice(raw.companySize),
    automationGoal: isValidAutomationGoal(raw.automationGoal)
      ? raw.automationGoal.trim()
      : null,
    goalSkipped: raw.goalSkipped === true,
    segmentAnsweredAt: asString(raw.segmentAnsweredAt),
    roleAnsweredAt: asString(raw.roleAnsweredAt),
    industryAnsweredAt: asString(raw.industryAnsweredAt),
    companySizeAnsweredAt: asString(raw.companySizeAnsweredAt),
    goalAnsweredAt: asString(raw.goalAnsweredAt),
  };
}

/** Drops anything the gateway would answer 400 to. An invalid value is a
 *  caller bug, reported to `onInvalid` rather than thrown: a sync is a mirror
 *  and must never break the answer the user just saved. */
export function sanitizeOnboardingPatch(
  patch: OnboardingSyncPatch,
  onInvalid: (reason: string) => void,
): OnboardingSyncPatch | null {
  const body: OnboardingSyncPatch = {};
  if (patch.role !== undefined) {
    if (isOnboardingRoleChoice(patch.role)) body.role = patch.role;
    else onInvalid(`dropped unknown role "${patch.role}"`);
  }
  if (patch.industry !== undefined) {
    if (isOnboardingIndustryChoice(patch.industry))
      body.industry = patch.industry;
    else onInvalid(`dropped unknown industry "${patch.industry}"`);
  }
  if (patch.companySize !== undefined) {
    if (isOnboardingCompanySizeChoice(patch.companySize))
      body.companySize = patch.companySize;
    else onInvalid(`dropped unknown company size "${patch.companySize}"`);
  }
  if (patch.automationGoal !== undefined) {
    if (isValidAutomationGoal(patch.automationGoal))
      body.automationGoal = patch.automationGoal.trim();
    else onInvalid("dropped out-of-range automation goal");
  }
  if (patch.goalSkipped !== undefined) body.goalSkipped = patch.goalSkipped;
  return Object.keys(body).length > 0 ? body : null;
}

/** The newest `*_answered_at` the gateway reports, for a record adopted whole. */
function latestAnswerAt(remote: GatewayOnboardingRecord): string | null {
  const stamps = [
    remote.segmentAnsweredAt,
    remote.roleAnsweredAt,
    remote.industryAnsweredAt,
    remote.companySizeAnsweredAt,
    remote.goalAnsweredAt,
  ].filter((s): s is string => s !== null && !Number.isNaN(Date.parse(s)));
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * Fold the gateway's copy into the local record, filling ONLY the questions
 * this device has no answer for (answered on another device, or backfilled
 * server-side). Local answers always win — the user is looking at them.
 * Returns null when nothing changes, so an unchanged record is never rewritten.
 *
 * Sync state is deliberately left alone: a record that already existed keeps
 * its `gatewaySyncedAt` (null ⇒ the catch-up flush still pushes, which is
 * idempotent), and a record built purely FROM the gateway starts stamped,
 * because nothing in it is ahead of the server.
 */
export function mergeGatewayOnboarding(
  local: OnboardingSurveyPreference | null,
  remote: GatewayOnboardingRecord | null,
): OnboardingSurveyPreference | null {
  if (!remote) return null;
  const base = local ?? createOnboardingSurveyPreference();
  // Conscious: the latest LOCAL goal action wins over the remote row (offline
  // text beats a remote skip; a local skip's later flush beats remote text).
  const goalAnsweredLocally = base.automationGoal !== null || base.goalSkipped;
  // A remote row holding BOTH text and the skip flag is a retraction the store
  // recorded incompletely (an older gateway, or a row written before the
  // server enforced exclusivity). The skip wins: resurrecting text the user
  // took back would put words in their mouth.
  const remoteGoal = remote.goalSkipped ? null : remote.automationGoal;
  const merged: OnboardingSurveyPreference = {
    ...base,
    segment: base.segment ?? remote.segment,
    role: base.role ?? normalizeOnboardingRoleChoice(remote.role),
    industry:
      base.industry ?? normalizeOnboardingIndustryChoice(remote.industry),
    companySize:
      base.companySize ??
      normalizeOnboardingCompanySizeChoice(remote.companySize),
    automationGoal: goalAnsweredLocally ? base.automationGoal : remoteGoal,
    goalSkipped: goalAnsweredLocally ? base.goalSkipped : remote.goalSkipped,
    updatedAt: local
      ? local.updatedAt
      : (latestAnswerAt(remote) ?? base.updatedAt),
    gatewaySyncedAt: local ? local.gatewaySyncedAt : new Date().toISOString(),
  };
  // No local record AND an empty gateway record: don't mint an empty survey.
  const before = local ?? createOnboardingSurveyPreference();
  return sameSurveyAnswers(before, merged) ? null : merged;
}

/**
 * Every answer the local record holds, as a PUT body — the payload of the
 * catch-up flush for a record whose write never reached the gateway.
 *
 * The goal question contributes exactly ONE field, never both: the server owns
 * the exclusivity invariant (text ⇒ `goal_skipped=false`, skip ⇒ the text is
 * nulled), so sending text and the skip flag together would only fight it.
 */
export function onboardingPatchFromSurvey(
  preference: OnboardingSurveyPreference,
): OnboardingSyncPatch | null {
  const patch: OnboardingSyncPatch = {};
  // "Something else" the person chose always carries their words. Without
  // them it is an id a newer build stored that this one cannot name
  // (`normalizeOnboardingRoleChoice`): sending it back would overwrite the
  // real answer on the gateway.
  if (
    preference.role !== null &&
    !unnamedSomethingElse(preference.role, preference.roleOther)
  )
    patch.role = preference.role;
  if (
    preference.industry !== null &&
    !unnamedSomethingElse(preference.industry, preference.industryOther)
  )
    patch.industry = preference.industry;
  if (preference.companySize !== null)
    patch.companySize = preference.companySize;
  if (preference.automationGoal !== null)
    patch.automationGoal = preference.automationGoal;
  else if (preference.goalSkipped) patch.goalSkipped = true;
  return Object.keys(patch).length > 0 ? patch : null;
}

function unnamedSomethingElse(answer: string, words: string | null): boolean {
  return answer === ONBOARDING_ANSWER_SOMETHING_ELSE && !words?.trim();
}
