import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  SURVEY_SKIPPED,
  surveyAbout,
  surveyAnswer,
  surveyAnswered,
} from "../src/lib/manager-onboarding/survey-script.ts";
import {
  createOnboardingSurveyPreference,
  type OnboardingSurveyPreference,
} from "../src/lib/onboarding-survey-record.ts";

const record = (
  patch: Partial<OnboardingSurveyPreference>,
): OnboardingSurveyPreference => ({
  ...createOnboardingSurveyPreference(),
  ...patch,
});

describe("surveyAnswer", () => {
  it("reads nothing from a missing record", () => {
    strictEqual(surveyAnswer(null, "industry"), null);
    strictEqual(surveyAnswer(null, "role"), null);
  });

  it("reads each stored answer", () => {
    const stored = record({
      industry: "legal",
      role: "paralegal",
      automationGoal: "Answer my emails",
    });
    strictEqual(surveyAnswer(stored, "industry"), "legal");
    strictEqual(surveyAnswer(stored, "role"), "paralegal");
    strictEqual(surveyAnswer(stored, "goal"), "Answer my emails");
  });

  it("shows the person's words for something else, when this device has them", () => {
    const stored = record({
      industry: "something_else",
      industryOther: "Dog grooming",
      role: "something_else",
      roleOther: "Groomer",
    });
    strictEqual(surveyAnswer(stored, "industry"), "Dog grooming");
    strictEqual(surveyAnswer(stored, "role"), "Groomer");
    strictEqual(
      surveyAnswer(record({ role: "something_else" }), "role"),
      "something_else",
    );
  });

  it("reads the company size as its bucket, or the skip", () => {
    strictEqual(
      surveyAnswer(record({ companySize: "51_200" }), "companySize"),
      "51_200",
    );
    strictEqual(
      surveyAnswer(record({ companySize: "skipped" }), "companySize"),
      SURVEY_SKIPPED,
    );
    strictEqual(surveyAnswer(record({}), "companySize"), null);
  });

  it("a skipped goal is an answer", () => {
    strictEqual(
      surveyAnswer(record({ goalSkipped: true }), "goal"),
      SURVEY_SKIPPED,
    );
  });

  it("a role only the retired department answered has nothing to show", () => {
    strictEqual(surveyAnswer(record({ segment: "sales" }), "role"), null);
  });
});

describe("surveyAnswered", () => {
  it("is false for a missing record", () => {
    strictEqual(surveyAnswered(null, "industry"), false);
    strictEqual(surveyAnswered(null, "role"), false);
    strictEqual(surveyAnswered(null, "goal"), false);
  });

  it("counts a department answered before the role question as the role", () => {
    strictEqual(surveyAnswered(record({ segment: "sales" }), "role"), true);
  });

  it("counts a company size only once it is answered", () => {
    strictEqual(surveyAnswered(record({}), "companySize"), false);
    strictEqual(
      surveyAnswered(record({ companySize: "solo" }), "companySize"),
      true,
    );
  });

  it("counts a skip as an answer", () => {
    strictEqual(surveyAnswered(record({ role: "skipped" }), "role"), true);
    strictEqual(surveyAnswered(record({ goalSkipped: true }), "goal"), true);
  });
});

describe("surveyAbout", () => {
  it("tells the industry, role and company size the person gave", () => {
    deepStrictEqual(
      surveyAbout(
        record({
          industry: "accounting",
          role: "founder",
          companySize: "2_10",
        }),
      ),
      { industry: "accounting", role: "founder", companySize: "2_10" },
    );
    deepStrictEqual(
      surveyAbout(record({ role: "something_else", roleOther: "Groomer" })),
      { industry: null, role: "Groomer", companySize: null },
    );
    deepStrictEqual(
      surveyAbout(
        record({ industry: "something_else", industryOther: "Pet care" }),
      ),
      { industry: "Pet care", role: null, companySize: null },
    );
  });

  it("says nothing it does not know: skips, bare something else, no record", () => {
    const nothing = { industry: null, role: null, companySize: null };
    deepStrictEqual(
      surveyAbout(record({ role: "skipped", companySize: "skipped" })),
      nothing,
    );
    deepStrictEqual(surveyAbout(record({ role: "something_else" })), nothing);
    deepStrictEqual(surveyAbout(null), nothing);
  });
});
