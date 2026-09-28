// `.ts` extensions so the node test runner can import this module directly.
import type {
  GatewayOnboardingRecord,
  OnboardingSyncPatch,
} from "./onboarding-gateway-record.ts";

/**
 * The answers a PUT sent that the gateway's answer does not hold. A 2xx alone
 * does not prove a write: a gateway that predates a field ignores it and still
 * answers 200, and a record marked synced on that would never send the answer
 * again. The PUT answers with the stored record, so each field sent is read
 * back from it.
 */
export function unstoredFields(
  sent: OnboardingSyncPatch,
  stored: GatewayOnboardingRecord | null,
): (keyof OnboardingSyncPatch)[] {
  const keys = Object.keys(sent) as (keyof OnboardingSyncPatch)[];
  if (!stored) return keys;
  return keys.filter((key) => stored[key] !== sent[key]);
}

/** The refusal codes naming one field the gateway cannot take yet (a role or
 *  a company size a newer build offers than it knows), and that field. */
const FIELD_OF_REFUSAL: Record<string, keyof OnboardingSyncPatch> = {
  invalid_role: "role",
  invalid_company_size: "companySize",
};

/** The one field a 400 refused, when the refusal names one this body sent. */
export function refusedField(
  code: unknown,
  sent: OnboardingSyncPatch,
): keyof OnboardingSyncPatch | null {
  if (typeof code !== "string") return null;
  const field = FIELD_OF_REFUSAL[code];
  return field !== undefined && field in sent ? field : null;
}

/** `sent` without `field`, or null when nothing else is left to send. */
export function withoutField(
  sent: OnboardingSyncPatch,
  field: keyof OnboardingSyncPatch,
): OnboardingSyncPatch | null {
  const rest = { ...sent };
  delete rest[field];
  return Object.keys(rest).length > 0 ? rest : null;
}
