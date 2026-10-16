// Where a LinkedIn connect comes back to: the desktop's loopback, the mobile
// app's deep link (its in-app browser holds no Houston session), or the web.

import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { linkedInConnectSurface } from "../src/components/organization/linkedin-connect-surface.ts";

describe("linkedInConnectSurface", () => {
  it("asks for the deep link in the mobile app, never the web return", () => {
    strictEqual(
      linkedInConnectSurface({ tauri: false, nativeMobile: true }),
      "mobileApp",
    );
  });

  it("listens on the desktop and returns to the web app in a browser", () => {
    strictEqual(
      linkedInConnectSurface({ tauri: true, nativeMobile: false }),
      "desktop",
    );
    strictEqual(
      linkedInConnectSurface({ tauri: false, nativeMobile: false }),
      "web",
    );
  });
});
