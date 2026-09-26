import { ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  type HandoffInput,
  handoffPrompt,
} from "../src/lib/manager-onboarding/handoff-prompt.ts";

const input: HandoffInput = {
  goal: "Chase my overdue invoices every Monday",
  about: { role: "Founder", companySize: "2_10" },
  team: [
    { name: "Ava", role: "Bookkeeper" },
    { name: "Jordan", role: "Chief of Staff" },
    { name: "Riley" },
  ],
  locale: "en",
  reach: { invite: false, connect: true },
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
        "About them:\n- Role: Founder\n- Company size: 2 to 10 people",
      ),
    );
    ok(
      handoffPrompt({
        ...input,
        about: { role: null, companySize: "solo" },
      }).includes(
        "About them:\n- Company size: just them, they work on their own\n\n",
      ),
    );
  });

  it("says nothing about the person when the survey knows nothing", () => {
    strictEqual(
      handoffPrompt({
        ...input,
        about: { role: null, companySize: null },
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

  it("asks to start the goal as a mission, or to hire for it first", () => {
    const prompt = handoffPrompt(input);
    ok(prompt.includes("start the work as a mission"));
    ok(prompt.includes("hire a new AI Employee for it"));
    ok(prompt.includes("plain, non-technical language"));
  });

  it("offers connecting a tool as a question only where tools connect", () => {
    ok(handoffPrompt(input).includes("a tool that has to be connected"));
    strictEqual(
      handoffPrompt({
        ...input,
        reach: { invite: false, connect: false },
      }).includes("connected"),
      false,
    );
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
