import { expect, test } from "vitest";
import { launchArgs, launchCandidates, noBrowserMessage } from "./launch";
import { networkFenceArgs } from "./network-fence";

test("a baked executable is tried first, then the headless shell, Chrome, Edge", () => {
  const candidates = launchCandidates(
    { HOUSTON_BROWSER_EXECUTABLE: "/opt/chrome-headless-shell" },
    1,
  );
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
  expect(
    launchCandidates({ HOUSTON_BROWSER_EXECUTABLE: " " }, 1)[0]?.label,
  ).toBe("Playwright headless shell");
});

test("the network fence leads, then shared memory off, then the operator's extras", () => {
  const fence = networkFenceArgs(41234);
  expect(fence).toEqual([
    "--proxy-server=http://127.0.0.1:41234",
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP 0.0.0.0 ~NOTFOUND, MAP :: ~NOTFOUND, MAP metadata ~NOTFOUND, MAP metadata. ~NOTFOUND, MAP *.internal ~NOTFOUND, MAP *.internal. ~NOTFOUND",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ]);
  expect(launchArgs({}, 41234)).toEqual([...fence, "--disable-dev-shm-usage"]);
  expect(
    launchArgs({ HOUSTON_BROWSER_ARGS: " --disable-http2  --lang=es " }, 41234),
  ).toEqual([
    ...fence,
    "--disable-dev-shm-usage",
    "--disable-http2",
    "--lang=es",
  ]);
});

test("every candidate carries the same fence, through the proxy on its port", () => {
  const args = launchCandidates(
    { HOUSTON_MANAGED_CLOUD: "1", HOUSTON_BROWSER_EXECUTABLE: "/x" },
    5050,
  ).map((c) => c.options.args);
  expect(args).toHaveLength(4);
  for (const a of args) expect(a).toEqual(args[0]);
  expect(args[0]).toContain("--proxy-server=http://127.0.0.1:5050");
  expect(args[0]?.filter((a) => a.startsWith("--proxy-bypass-list"))).toEqual([
    "--proxy-bypass-list=<-loopback>",
  ]);
});

test("the browser never inherits this process's secrets", () => {
  const env = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    TMPDIR: "/tmp/x",
    LANG: "es_MX.UTF-8",
    LC_ALL: "es_MX.UTF-8",
    TZ: "America/Bogota",
    FONTCONFIG_PATH: "/etc/fonts",
    XDG_CACHE_HOME: "/home/u/.cache",
    SystemRoot: "C:\\Windows",
    HOUSTON_TURN_TOKEN: "turn-v1.secret",
    HOUSTON_HOST_TOKEN: "host-secret",
    ANTHROPIC_API_KEY: "sk-ant",
    COMPOSIO_API_KEY: "c",
    AWS_SECRET_ACCESS_KEY: "a",
    DISPLAY: ":0",
    HOUSTON_BROWSER_SANDBOX: "1",
  };
  for (const candidate of launchCandidates(env, 1)) {
    expect(candidate.options.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      TMPDIR: "/tmp/x",
      LANG: "es_MX.UTF-8",
      LC_ALL: "es_MX.UTF-8",
      TZ: "America/Bogota",
      FONTCONFIG_PATH: "/etc/fonts",
      XDG_CACHE_HOME: "/home/u/.cache",
      SystemRoot: "C:\\Windows",
    });
  }
});

test("Chromium's own sandbox is on everywhere unless the operator opts out with 0", () => {
  const sandboxed = (env: Record<string, string>) =>
    launchCandidates(env, 1).map((c) => c.options.chromiumSandbox);
  expect(sandboxed({})).toEqual([true, true, true]);
  expect(sandboxed({ HOUSTON_BROWSER_SANDBOX: "1" })).toEqual([
    true,
    true,
    true,
  ]);
  expect(sandboxed({ HOUSTON_BROWSER_SANDBOX: "" })).toEqual([
    true,
    true,
    true,
  ]);
  expect(
    sandboxed({
      HOUSTON_BROWSER_SANDBOX: "0",
      HOUSTON_BROWSER_EXECUTABLE: "/x",
    }),
  ).toEqual([false, false, false, false]);
});

test("popup blocking stays on: Playwright's --disable-popup-blocking is dropped", () => {
  for (const c of launchCandidates({}, 1))
    expect(c.options.ignoreDefaultArgs).toEqual(["--disable-popup-blocking"]);
});

test("the no-browser refusal never tells a cloud user to install Chrome", () => {
  expect(noBrowserMessage({})).toContain("Installing Google Chrome");
  const cloud = noBrowserMessage({ HOUSTON_MANAGED_CLOUD: "1" });
  expect(cloud).not.toMatch(/install|chrome/i);
  expect(cloud).toContain("Houston's side");
});
