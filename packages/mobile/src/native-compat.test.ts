import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import compat from "../native-compat.json";
import {
  lockedNativeVersions,
  nativeFingerprint,
} from "../scripts/native-fingerprint";

// Every native fingerprint, oldest first, with the first store build that
// carries it. Anything a store build bakes in (locked native plugin versions,
// capacitor.config.ts, Info.plist, entitlements, app delegates,
// AndroidManifest.xml, MainActivity, Android XML resources) changes the hash:
// APPEND an entry, never edit one, with a build above every store build already
// uploaded, and move min_native_build (and the native build numbers) to it.
// Store builds are github.run_number * 100 + github.run_attempt (attempt < 100);
// the first mobile-release run uploads 101.
const nativeBaselines = [
  {
    min_native_build: 101,
    sha256: "bd8bfb425621f800d2de8b1b22428eeabd59b127d1255b5e33146851ce14ba2b",
  },
] as const;

test("a native fingerprint change moves the OTA floor past every older build", () => {
  const fingerprint = nativeFingerprint(process.cwd());
  const latest = nativeBaselines.at(-1);
  expect(compat.native_fingerprint_sha256).toBe(fingerprint);
  expect(latest?.sha256).toBe(fingerprint);
  expect(compat.min_native_build).toBe(latest?.min_native_build);
  nativeBaselines.forEach((entry, index) => {
    const attempt = entry.min_native_build % 100;
    expect(entry.min_native_build).toBeGreaterThan(100);
    expect(attempt).toBeGreaterThan(0);
    const previous = nativeBaselines[index - 1];
    if (previous)
      expect(entry.min_native_build).toBeGreaterThan(previous.min_native_build);
  });
  expect(compat.required_native_build).toBeGreaterThanOrEqual(
    compat.min_native_build,
  );
  // Local builds (including the hand-uploaded first Play bundle) sit one below
  // the first CI store build, so they never reuse its versionCode.
  const local = compat.min_native_build - 1;
  expect(readFileSync("android/app/build.gradle", "utf8")).toContain(
    `System.getenv('HOUSTON_NATIVE_BUILD_NUMBER') ?: '${local}'`,
  );
  expect(
    readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8"),
  ).toContain(`CURRENT_PROJECT_VERSION = ${local};`);
});

test("the fingerprint reads resolved plugin versions, not package.json ranges", () => {
  const lock = [
    "importers:",
    "  packages/mobile:",
    "    dependencies:",
    "      '@capacitor/app':",
    "        specifier: ^8.1.2",
    "        version: 8.1.9(@capacitor/core@8.5.3)",
    "      '@capacitor/core':",
    "        specifier: 8.5.3",
    "        version: 8.5.3",
    "      react:",
    "        specifier: 19.2.7",
    "        version: 19.2.7",
    "  packages/web:",
    "    dependencies:",
    "      '@capgo/capacitor-updater':",
    "        specifier: 1.0.0",
    "        version: 1.0.0",
    "",
  ].join("\n");
  expect(lockedNativeVersions(`lockfileVersion: '9.0'\n${lock}`)).toEqual({
    "@capacitor/app": "8.1.9",
    "@capacitor/core": "8.5.3",
  });
});
