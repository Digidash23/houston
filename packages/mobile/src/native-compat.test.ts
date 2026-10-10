import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import compat from "../native-compat.json";
import {
  lockedNativeVersions,
  nativeFingerprint,
} from "../scripts/native-fingerprint";

// This frozen pair forces a native build bump when anything a store build bakes
// in changes: locked native plugin versions, capacitor.config.ts, Info.plist,
// entitlements, AndroidManifest.xml, MainActivity and the app delegates. Advance
// both values only with new iOS/Android native build numbers.
const nativeBaseline = {
  build: 4,
  sha256: "bd8bfb425621f800d2de8b1b22428eeabd59b127d1255b5e33146851ce14ba2b",
};

test("native compatibility records the native build's fingerprint", () => {
  const fingerprint = nativeFingerprint(process.cwd());
  expect(compat.native_fingerprint_sha256).toBe(fingerprint);
  expect(compat.required_native_build).toBe(nativeBaseline.build);
  expect(fingerprint).toBe(nativeBaseline.sha256);
  expect(compat.required_native_build).toBeGreaterThanOrEqual(
    compat.min_native_build,
  );
  expect(readFileSync("android/app/build.gradle", "utf8")).toContain(
    `System.getenv('HOUSTON_NATIVE_BUILD_NUMBER') ?: '${compat.required_native_build}'`,
  );
  expect(
    readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8"),
  ).toContain(`CURRENT_PROJECT_VERSION = ${compat.required_native_build};`);
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
