import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const updates = () =>
  readFileSync("../../.github/workflows/mobile-updates.yml", "utf8");

test("automatic publishes and rollbacks carry the live required floor, never the repo's", () => {
  const yaml = updates();
  const select = yaml
    .split("- name: Select bundle version and compatibility")[1]
    ?.split("- name: Sign manifest")[0];
  expect(select).toContain(
    "current_required=$(jq -r '.required_native_build' packages/mobile/current-manifest.json)",
  );
  expect(select).toContain("required=$current_required");
  expect(select).not.toMatch(/required_native_build[^\n]*native-compat\.json/);
  expect(select).not.toContain("cp packages/mobile/native-compat.json");
  // Only the explicit dispatch raises it, and only upward.
  expect(select).toContain("required=$RAISE_REQUIRED");
  expect(select).toContain('test "$RAISE_REQUIRED" -gt "$current_required"');
  expect(yaml).toContain("options: [rollback, raise-required-native-build]");
});
