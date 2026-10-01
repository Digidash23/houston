import { ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  goalRetryPrompt,
  type HandoffInput,
  handoffPrompt,
} from "../src/lib/manager-onboarding/handoff-prompt.ts";

const input: HandoffInput = {
  goal: "Chase my overdue invoices every Monday",
  about: { industry: "Accounting", role: "Founder", companySize: "2_10" },
  freeColor: "golden",
  team: [
    { name: "Ava", role: "Bookkeeper" },
    { name: "Jordan", role: "Chief of Staff" },
    { name: "Riley" },
  ],
  locale: "en",
};

describe("handoffPrompt", () => {
  it("carries the goal in the person's own words", () => {
    ok(
      handoffPrompt(input).includes(
        'Their goal, in their own words: "Chase my overdue invoices every Monday"',
      ),
    );
  });

  it("tells the manager who the person is, as far as the survey knows", () => {
    ok(
      handoffPrompt(input).includes(
        "About them:\n- Industry: Accounting\n- Role: Founder\n- Company size: 2 to 10 people",
      ),
    );
    ok(
      handoffPrompt({
        ...input,
        about: { industry: null, role: null, companySize: "solo" },
      }).includes(
        "About them:\n- Company size: just them, they work on their own\n\n",
      ),
    );
  });

  it("says nothing about the person when the survey knows nothing", () => {
    strictEqual(
      handoffPrompt({
        ...input,
        about: { industry: null, role: null, companySize: null },
      }).includes("About them"),
      false,
    );
  });

  it("names every AI Employee with the job it has", () => {
    const prompt = handoffPrompt(input);
    ok(
      prompt.includes("- Ava (Bookkeeper)\n- Jordan (Chief of Staff)\n- Riley"),
    );
  });

  it("says so when nobody is on the team yet", () => {
    ok(handoffPrompt({ ...input, team: [] }).includes("- None yet"));
  });

  it("uses a fitting teammate first, otherwise seeds a tailored hire in a free color", () => {
    const prompt = handoffPrompt(input);
    ok(prompt.includes("already on their team clearly fits the goal"));
    ok(prompt.includes("start_mission"));
    ok(prompt.includes("createAgent"));
    ok(prompt.includes('color "golden"'));
    ok(prompt.includes("seed.claudeMd"));
    ok(prompt.includes("using only name"));
    ok(prompt.includes("already approved"));
    ok(prompt.includes("Do not ask for confirmation"));
    strictEqual(prompt.includes("said yes"), false);
    ok(prompt.includes("Chase my overdue invoices every Monday"));
  });

  it("works silently, since the goal card shows every step", () => {
    const prompt = handoffPrompt(input);
    ok(prompt.includes("Work silently"));
    ok(prompt.includes("No narration, chatter or questions"));
    ok(prompt.includes("say so plainly in one sentence and stop"));
  });

  it("asks for a reply in the app's language", () => {
    ok(handoffPrompt(input).endsWith("Reply in English."));
    ok(
      handoffPrompt({ ...input, locale: "es" }).endsWith(
        "Reply in Latin American Spanish, addressing the person as tú.",
      ),
    );
    ok(
      handoffPrompt({ ...input, locale: "pt" }).endsWith(
        "Reply in Brazilian Portuguese, addressing the person as você.",
      ),
    );
  });
});

describe("goalRetryPrompt", () => {
  it("starts the same goal again, reusing an employee already hired for it", () => {
    const prompt = goalRetryPrompt({ goal: input.goal, locale: "es" });
    ok(prompt.includes("pressed Try again"));
    ok(prompt.includes(`Their goal, in their own words: "${input.goal}"`));
    ok(prompt.includes("use the AI Employee you already hired for it"));
    ok(prompt.includes("Work silently"));
    ok(
      prompt.endsWith(
        "Reply in Latin American Spanish, addressing the person as tú.",
      ),
    );
  });
});
