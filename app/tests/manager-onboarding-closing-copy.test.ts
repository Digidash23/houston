import { ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { it } from "node:test";

interface OnboardingCopy {
  say: Record<string, unknown>;
  teamCard: { abilities: Record<string, string> };
  goalCard: Record<string, string>;
}

function onboardingCopy(locale: "en" | "es" | "pt"): OnboardingCopy {
  const path = new URL(
    `../src/locales/${locale}/assistant.json`,
    import.meta.url,
  );
  return (
    JSON.parse(readFileSync(path, "utf8")) as { onboarding: OnboardingCopy }
  ).onboarding;
}

it("tells the person they can give their AI Employees work directly", () => {
  strictEqual(
    onboardingCopy("en").say.closingEmployees,
    "Open any of your AI Employees to give them work directly.",
  );
});

it("leaves the goal to its card: no closing goal line, no narration", () => {
  for (const locale of ["en", "es", "pt"] as const) {
    const copy = onboardingCopy(locale);
    strictEqual("closingGoal" in copy.say, false);
    strictEqual("handoff" in copy, false);
  }
});

it("names the employee on every goal card step that has one, and asks nothing", () => {
  for (const locale of ["en", "es", "pt"] as const) {
    const { goalCard, teamCard } = onboardingCopy(locale);
    for (const key of ["hiring", "hired", "picked", "working", "open"])
      ok(goalCard[key]?.includes("{{name}}"), `${locale} ${key}`);
    ok(goalCard.goal?.includes("{{goal}}"));
    for (const line of [
      ...Object.values(goalCard),
      ...Object.values(teamCard.abilities),
    ])
      ok(!line.includes("?"), `${locale}: ${line}`);
  }
});
