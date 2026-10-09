import { expect, test } from "vitest";
import { launchArgs, launchCandidates, networkFenceArgs } from "./launch";

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

test("the network fence leads, then shared memory off, then the operator's extras", () => {
  const fence = [
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=*;<-loopback>",
    "--host-resolver-rules=MAP 0.0.0.0 ~NOTFOUND, MAP :: ~NOTFOUND, MAP metadata ~NOTFOUND, MAP *.internal ~NOTFOUND",
  ];
  expect(launchArgs({})).toEqual([...fence, "--disable-dev-shm-usage"]);
  expect(
    launchArgs({ HOUSTON_BROWSER_ARGS: " --disable-http2  --lang=es " }),
  ).toEqual([
    ...fence,
    "--disable-dev-shm-usage",
    "--disable-http2",
    "--lang=es",
  ]);
});

test("a fixture host rule is added ahead of the fence's own rules", () => {
  expect(networkFenceArgs(["MAP site.test 127.0.0.1"])[2]).toBe(
    "--host-resolver-rules=MAP site.test 127.0.0.1, MAP 0.0.0.0 ~NOTFOUND, MAP :: ~NOTFOUND, MAP metadata ~NOTFOUND, MAP *.internal ~NOTFOUND",
  );
});
