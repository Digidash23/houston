import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { missionsGuidance } from "./houston-prompt-missions";

test("mission guidance matches the desktop prompt and covers teamwork", () => {
  const rust = readFileSync(
    fileURLToPath(
      new URL(
        "../../../app/src-tauri/src/houston_prompt/missions.rs",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const rustGuidance = rust.match(
    /pub const MISSIONS_GUIDANCE: &str = r#"([\s\S]*?)"#;/,
  )?.[1];

  expect(rustGuidance).toBe(missionsGuidance);
  expect(missionsGuidance).toContain("## Working with other AI Employees");
  expect(missionsGuidance).toContain(
    "`list_agents` and read what one does with `read_agent`",
  );
  expect(missionsGuidance).toContain("setting `agent` to its name");
  expect(missionsGuidance).toContain("complete, standalone instructions");
  expect(missionsGuidance).toContain("cannot be handed on");
  expect(missionsGuidance).toContain("change Teamwork in your settings");
});
