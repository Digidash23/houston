import { expect, test } from "vitest";
import config from "../capacitor.config";

// Capacitor 8's core SystemBars plugin owns the Android keyboard inset; the
// Keyboard plugin skips its resizeOnFullScreen path whenever SystemBars is
// present and logs a warning to omit the option. iOS resizes natively.
test("the keyboard resizes natively with no resizeOnFullScreen", () => {
  expect(config.plugins?.Keyboard).toEqual({ resize: "native" });
  expect(config.plugins?.SystemBars).toMatchObject({ insetsHandling: "css" });
});
