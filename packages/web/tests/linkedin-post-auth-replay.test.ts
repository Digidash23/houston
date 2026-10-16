import { HoustonClient } from "@houston/engine-adapter/client";
import { resetRejectedBearers } from "@houston/engine-adapter/cp/bearer-recovery";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createWireCapture,
  installLocalStorage,
  json,
  ORG,
} from "./support/wire-capture";

/**
 * The transport answers a 401 by refreshing the session and replaying with
 * the bearer current then. A LinkedIn post is never replayed: by the time its
 * 401 lands, someone else may be signed in, and the replay would post the
 * first person's picture on the second person's LinkedIn.
 */

const BASE = "http://host";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const { calls, reset, restore, stubRouted } = createWireCapture();
const engine = { baseUrl: BASE, token: "bearer-ada" };

beforeEach(() => {
  installLocalStorage();
  reset();
  engine.token = "bearer-ada";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __HOUSTON_ENGINE__: engine,
      // Grace signed in meanwhile: the refresh answers her bearer.
      __HOUSTON_SESSION_REFRESH__: async () => engine.token,
      __HOUSTON_CP__: true,
    },
  });
});

afterEach(() => {
  restore();
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  resetRejectedBearers();
  vi.clearAllMocks();
});

function client() {
  const c = new HoustonClient({
    baseUrl: BASE,
    token: "t",
    controlPlane: true,
  });
  c.setActiveOrg(ORG);
  return c;
}

/** The first request is refused once the account switched; the rest land. */
function refuseAcrossSwitch() {
  stubRouted(async () => {
    if (calls.length > 1) return json(200, { connected: false });
    engine.token = "bearer-grace";
    return json(401, { error: "token expired" });
  });
}

const bearers = () => calls.map((c) => c.headers.get("Authorization"));

test("a post refused after an account switch is sent once, as its own person", async () => {
  refuseAcrossSwitch();
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
  await expect(
    client().postLinkedInImage({ image: png, text: "Hi" }),
  ).resolves.toEqual({ kind: "refused", code: "signed_out" });
  expect(bearers()).toEqual(["Bearer bearer-ada"]);
});

// The same 401 on any other request still heals by replaying.
test("a read refused the same way is replayed with the refreshed bearer", async () => {
  refuseAcrossSwitch();
  await client().linkedInConnection();
  expect(bearers()).toEqual(["Bearer bearer-ada", "Bearer bearer-grace"]);
});
