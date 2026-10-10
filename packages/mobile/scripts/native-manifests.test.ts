import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

test("iOS declares camera and microphone use for WebView photo and video capture", () => {
  const plist = read("ios/App/App/Info.plist");
  // A file input's "Take Photo or Video" crashes the app without these keys.
  for (const key of [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ])
    expect(plist).toMatch(
      new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`),
    );
});
