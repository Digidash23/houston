/**
 * First-run state: reaching onboarding, and the account records it reads and
 * writes on the host.
 *
 * First-run onboarding runs INSIDE the workspace shell, as the AI Manager's
 * scripted conversation (connect your AI → the survey → build the team).
 * Walking that conversation lives in `manager-onboarding.ts` and
 * `manager-team.ts`; this module owns only the host state around it.
 */
import { FAKE_HOST_URL } from "@houston/fake-host";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

/** The account preference the survey record lives under. */
export const SURVEY_PREF_KEY = "houston_onboarding_survey";

/**
 * Write one ACCOUNT preference straight onto the host (`null` clears it) — the
 * keys `ACCOUNT_PREF_KEYS` routes off this device
 * (packages/engine-adapter/src/client/config-prefs-mixin.ts).
 */
export async function setAccountPreference(
  request: APIRequestContext,
  key: string,
  value: string | null,
): Promise<void> {
  await request.put(`${FAKE_HOST_URL}/v1/preferences/${key}`, {
    data: { value },
  });
}

/** One ACCOUNT preference as the host holds it, or null when unset. */
export async function readAccountPreference(
  request: APIRequestContext,
  key: string,
): Promise<string | null> {
  const response = await request.get(`${FAKE_HOST_URL}/v1/preferences/${key}`);
  const body = (await response.json()) as { value: string | null };
  return body.value;
}

/** The survey record's answers, as the host holds them. */
export interface StoredSurvey {
  segment: string | null;
  role: string | null;
  roleOther: string | null;
  industry: string | null;
  industryOther: string | null;
  /** Absent from a record written before the question existed. */
  companySize?: string | null;
  automationGoal: string | null;
  goalSkipped: boolean;
}

/** The survey record the host holds, or null before the first answer. */
export async function readSurveyRecord(
  request: APIRequestContext,
): Promise<StoredSurvey | null> {
  const raw = await readAccountPreference(request, SURVEY_PREF_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredSurvey);
}

/**
 * Store a finished survey on the account (every question answered, already
 * synced), so a surface that opens on the survey's answers opens on
 * `industry` and `role`, and no completion prompt is owed.
 */
export async function seedAnsweredSurvey(
  request: APIRequestContext,
  industry: string,
  role = "operations_manager",
): Promise<void> {
  await setAccountPreference(
    request,
    SURVEY_PREF_KEY,
    JSON.stringify({
      version: 2,
      segment: null,
      role,
      roleOther: null,
      industry,
      industryOther: null,
      companySize: "2_10",
      automationGoal: "Stay on top of my email",
      goalSkipped: false,
      completionPromptDismissed: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      gatewaySyncedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

/**
 * Empty the host's agents so the next `goto("/")` starts a first run (v3
 * first-run = zero agents). The durable onboarding preferences need no clearing
 * here: the page fixture resets the whole fake host before every test, and each
 * test gets a fresh browser context (so the localStorage mirrors go too).
 */
export async function resetToFirstRun(
  request: APIRequestContext,
): Promise<void> {
  const agents = (await (
    await request.get(`${FAKE_HOST_URL}/agents`)
  ).json()) as { id: string }[];
  for (const agent of agents) {
    await request.delete(`${FAKE_HOST_URL}/agents/${agent.id}`);
  }
}

/**
 * Boot into the AI Manager's onboarding conversation. Reduced motion shows
 * each of the manager's messages whole instead of typing it out word by word,
 * so every step is on screen as soon as the conversation reaches it. The
 * emulation outlives a reload.
 */
export async function openManagerOnboarding(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // The first wait after a cold boot matches the visual suite's other
  // boot-dependent waits: CI boots near the 10s default.
  await expect(page.getByTestId("manager-onboarding")).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * The pre-survey answer as an early build stored it: a user who answered the
 * department question before the survey existed. It answers the role, so
 * lifting it owes the completion prompt the industry and the goal.
 */
export function legacySegmentPreference(segment = "operations"): string {
  return JSON.stringify({
    segment,
    selectedAt: "2026-01-01T00:00:00.000Z",
    sourceScreen: "first_run_segment",
  });
}

/**
 * Seed the pre-survey answer into the DEVICE mirror the old segment hook wrote
 * first, with nothing on the host. That is the state of a hosted user whose
 * engine write never landed (warming pod), and the only copy of their answer.
 */
export async function seedLegacySegmentMirror(
  page: Page,
  segment?: string,
): Promise<void> {
  await page.addInitScript((value: string) => {
    // Signed-out harness → the hook's uid-scoped key falls back to "local".
    localStorage.setItem("houston.onboarding-segment.local", value);
  }, legacySegmentPreference(segment));
}
