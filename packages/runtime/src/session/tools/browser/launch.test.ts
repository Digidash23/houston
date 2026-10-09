import { expect, test } from "vitest";
import { launchArgs, launchCandidates } from "./launch";

test("a baked executable is tried first, then the headless shell, Chrome, Edge", () => {
  const candidates = launchCandidates({
    HOUSTON_BROWSER_EXECUTABLE: "/opt/chrome-headless-shell",
  });
  expect(candidates.map((c) => c.label)).toEqual([
    "HOUSTON_BROWSER_EXECUTABLE (/opt/chrome-headless-shell)",
    "Playwright headless shell",
    "Google Chrome",
    "Microsoft Edge",
  ]);
  expect(candidates[0]?.options.executablePath).toBe(
    "/opt/chrome-headless-shell",
  );
  expect(candidates[2]?.options.channel).toBe("chrome");
  expect(candidates[3]?.options.channel).toBe("msedge");
  for (const c of candidates) expect(c.options.headless).toBe(true);
});

test("without a baked executable the list starts at the headless shell", () => {
  expect(launchCandidates({ HOUSTON_BROWSER_EXECUTABLE: " " })[0]?.label).toBe(
    "Playwright headless shell",
  );
});

test("shared memory is always off; extra args come from the environment", () => {
  expect(launchArgs({})).toEqual(["--disable-dev-shm-usage"]);
  expect(
    launchArgs({ HOUSTON_BROWSER_ARGS: " --disable-http2  --lang=es " }),
  ).toEqual(["--disable-dev-shm-usage", "--disable-http2", "--lang=es"]);
});
