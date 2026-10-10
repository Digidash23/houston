import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EditableProfile } from "@houston/engine-adapter";
import { patchEditableProfile } from "../src/lib/editable-profile-patch.ts";

const google = (): EditableProfile => ({
  displayName: "Ada Lovelace",
  photoUrl: "https://lh3.example/ada.png",
  custom: { displayName: false, photoUrl: false },
});

describe("patchEditableProfile", () => {
  it("sets a new name as the user's own and leaves the picture alone", () => {
    const next = patchEditableProfile(google(), { displayName: "Ada" });
    assert.deepEqual(next, {
      displayName: "Ada",
      photoUrl: "https://lh3.example/ada.png",
      custom: { displayName: true, photoUrl: false },
    });
  });

  it("shows an uploaded picture before the host stores it", () => {
    const next = patchEditableProfile(google(), {
      photoUrl: "data:image/png;base64,AAAA",
    });
    assert.equal(next?.photoUrl, "data:image/png;base64,AAAA");
    assert.equal(next?.custom.photoUrl, true);
  });

  it("clears a removed picture until the host answers with Google's", () => {
    const own = patchEditableProfile(google(), { photoUrl: "data:x" });
    const next = patchEditableProfile(own, { photoUrl: null });
    assert.equal(next?.photoUrl, undefined);
    assert.equal("photoUrl" in (next ?? {}), false);
    assert.equal(next?.custom.photoUrl, false);
  });

  it("is idempotent and keeps an unchanged profile as the same object", () => {
    const once = patchEditableProfile(google(), { displayName: "Ada" });
    assert.equal(patchEditableProfile(once, { displayName: "Ada" }), once);
    const base = google();
    assert.equal(patchEditableProfile(base, {}), base);
  });

  it("leaves a profile that never loaded unloaded", () => {
    assert.equal(
      patchEditableProfile(undefined, { displayName: "Ada" }),
      undefined,
    );
    assert.equal(patchEditableProfile(null, { displayName: "Ada" }), null);
  });
});
