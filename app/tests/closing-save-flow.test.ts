import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  afterClosingSave,
  type PageRestoreTarget,
  resumeOnPageRestore,
  type SaveOutcome,
} from "../src/lib/manager-onboarding/closing-save-flow.ts";

describe("afterClosingSave", () => {
  it("finishes on every outcome but an abort, and holds on an abort", () => {
    const seen: Record<SaveOutcome, string> = {
      saved: "",
      unsaved: "",
      failed: "",
      aborted: "",
    };
    for (const outcome of Object.keys(seen) as SaveOutcome[]) {
      afterClosingSave(outcome, {
        finish: () => {
          seen[outcome] = "finish";
        },
        hold: () => {
          seen[outcome] = "hold";
        },
      });
    }
    deepStrictEqual(seen, {
      saved: "finish",
      unsaved: "finish",
      failed: "finish",
      aborted: "hold",
    });
  });
});

function fakePage() {
  const handlers = new Set<(event: { persisted: boolean }) => void>();
  const target: PageRestoreTarget = {
    addEventListener: (_type, handler) => void handlers.add(handler),
    removeEventListener: (_type, handler) => void handlers.delete(handler),
  };
  return {
    target,
    show: (persisted: boolean) => {
      for (const handler of [...handlers]) handler({ persisted });
    },
    listeners: () => handlers.size,
  };
}

describe("resumeOnPageRestore", () => {
  it("resumes once on a back/forward-cache restore, then stops listening", () => {
    const page = fakePage();
    let resumed = 0;
    resumeOnPageRestore(page.target, () => {
      resumed += 1;
    });
    page.show(true);
    page.show(true);
    strictEqual(resumed, 1);
    strictEqual(page.listeners(), 0);
  });

  it("ignores a fresh load (pageshow without persisted)", () => {
    const page = fakePage();
    let resumed = 0;
    resumeOnPageRestore(page.target, () => {
      resumed += 1;
    });
    page.show(false);
    strictEqual(resumed, 0);
    strictEqual(page.listeners(), 1);
  });

  it("the returned stop removes the listener", () => {
    const page = fakePage();
    const stop = resumeOnPageRestore(page.target, () => {});
    stop();
    strictEqual(page.listeners(), 0);
  });
});
