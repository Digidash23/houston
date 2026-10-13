import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  createTimezoneSeed,
  TIMEZONE_KEY,
  type TimezonePrefs,
  timezoneOwner,
} from "../src/lib/timezone-seed.ts";

/** One preference store per owner, the way the gateway keys them. */
function harness(stored: Record<string, string | null> = {}) {
  let owner = "";
  const store = new Map(Object.entries(stored));
  const writes: [string, string, string | null][] = [];
  const reports: unknown[] = [];
  const prefs: TimezonePrefs = {
    get: async (key) => store.get(`${owner}/${key}`) ?? null,
    set: async (key, value) => {
      writes.push([owner, key, value]);
      store.set(`${owner}/${key}`, value);
    },
  };
  const seed = createTimezoneSeed({
    prefs,
    detect: () => "America/Bogota",
    report: (_command, err) => reports.push(err),
  });
  return {
    seed,
    writes,
    reports,
    as: (next: string) => {
      owner = next;
      return seed.forOwner(next);
    },
  };
}

describe("timezone seed", () => {
  it("saves the detected zone once when the person has none", async () => {
    const h = harness();
    strictEqual(await h.as("ana:personal"), "America/Bogota");
    strictEqual(await h.seed.forOwner("ana:personal"), "America/Bogota");
    deepStrictEqual(h.writes, [
      ["ana:personal", TIMEZONE_KEY, "America/Bogota"],
    ]);
    deepStrictEqual(h.seed.current(), {
      value: "America/Bogota",
      loaded: true,
    });
  });

  it("never overwrites a zone the person already has", async () => {
    const h = harness({ "ana:personal/timezone": "Europe/Madrid" });
    strictEqual(await h.as("ana:personal"), "Europe/Madrid");
    deepStrictEqual(h.writes, []);
  });

  it("treats a blank stored value as unset", async () => {
    const h = harness({ "ana:personal/timezone": "  " });
    strictEqual(await h.as("ana:personal"), "America/Bogota");
    strictEqual(h.writes.length, 1);
  });

  it("seeds again for a new person or a new space", async () => {
    const h = harness({ "ana:personal/timezone": "Europe/Madrid" });
    await h.as("ana:personal");
    strictEqual(await h.as("ana:0123456789abcdef"), "America/Bogota");
    strictEqual(await h.as("bob:personal"), "America/Bogota");
    deepStrictEqual(
      h.writes.map(([who]) => who),
      ["ana:0123456789abcdef", "bob:personal"],
    );
  });

  it("concurrent loads share one read", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.as("ana:personal"), h.seed.load()]);
    strictEqual(a, b);
    strictEqual(h.writes.length, 1);
  });

  it("a failed save reports and still renders the detected zone", async () => {
    const h = harness();
    const failing = createTimezoneSeed({
      prefs: {
        get: async () => null,
        set: async () => {
          throw new Error("offline");
        },
      },
      detect: () => "Asia/Tokyo",
      report: (_c, err) => h.reports.push(err),
    });
    strictEqual(await failing.forOwner("ana:personal"), "Asia/Tokyo");
    strictEqual(h.reports.length, 1);
    strictEqual(failing.current().loaded, true);
  });

  it("a chosen zone wins and notifies subscribers", async () => {
    const h = harness();
    let calls = 0;
    const off = h.seed.subscribe(() => {
      calls += 1;
    });
    await h.as("ana:personal");
    await h.seed.set("Europe/Lisbon");
    off();
    deepStrictEqual(h.seed.current(), { value: "Europe/Lisbon", loaded: true });
    strictEqual(calls >= 2, true);
  });
});

describe("timezone owner", () => {
  it("is one person in one space, once both are known", () => {
    strictEqual(timezoneOwner("ana", true, "ws-1"), "ana:personal");
    strictEqual(
      timezoneOwner("ana", true, "org:0123456789abcdef"),
      "ana:0123456789abcdef",
    );
    strictEqual(timezoneOwner(null, true, "ws-1"), null);
    strictEqual(timezoneOwner("ana", true, null), null);
  });

  it("is the one local person when no identity is configured", () => {
    strictEqual(timezoneOwner(null, false, "ws-1"), "local:personal");
  });
});
