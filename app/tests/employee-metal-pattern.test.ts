import { notStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  employeeEngravingColor,
  employeeEngravingRole,
  roleLabelIndex,
} from "../src/components/employee-card/employee-metal-pattern.ts";
import en from "../src/locales/en/agent-onboarding.json" with { type: "json" };
import es from "../src/locales/es/agent-onboarding.json" with { type: "json" };
import pt from "../src/locales/pt/agent-onboarding.json" with { type: "json" };

const index = roleLabelIndex([
  en.roleSetup.roles,
  es.roleSetup.roles,
  pt.roleSetup.roles,
]);

describe("employee engraving inputs", () => {
  it("engraves a catalog role the same in every language", () => {
    const key = employeeEngravingRole(
      en.roleSetup.roles.academic_advisor,
      index,
    );
    strictEqual(
      employeeEngravingRole(es.roleSetup.roles.academic_advisor, index),
      key,
    );
    strictEqual(
      employeeEngravingRole(pt.roleSetup.roles.academic_advisor, index),
      key,
    );
    strictEqual(employeeEngravingRole("  ACADEMIC ADVISOR ", index), key);
  });

  it("engraves a typed role by its words", () => {
    strictEqual(
      employeeEngravingRole("Chief vibes officer", index),
      employeeEngravingRole(" chief VIBES officer", index),
    );
    notStrictEqual(
      employeeEngravingRole("Chief vibes officer", index),
      employeeEngravingRole(en.roleSetup.roles.academic_advisor, index),
    );
  });

  it("engraves a palette color the same whichever form is stored", () => {
    const palette = [{ id: "forest", light: "#1a4", dark: "#2b5" }];
    strictEqual(employeeEngravingColor("#1a4", palette), "forest");
    strictEqual(employeeEngravingColor("#2b5", palette), "forest");
    strictEqual(employeeEngravingColor("forest", palette), "forest");
    strictEqual(employeeEngravingColor(undefined, palette), "forest");
    strictEqual(employeeEngravingColor("#abcdef", palette), "#abcdef");
  });
});
