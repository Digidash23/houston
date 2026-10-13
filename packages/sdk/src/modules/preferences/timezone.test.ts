import { describe, expect, test } from "vitest";
import { createTimezoneSeeder, TIMEZONE_PREFERENCE } from "./timezone";

/** A preference store per active space, read off a live pointer the way the
 *  transport reads `x-houston-org` when a request starts. */
function harness(seed: Record<string, string> = {}) {
  const stored = new Map(Object.entries(seed));
  const writes: string[] = [];
  let space = "personal";
  let releaseRead: (() => void) | undefined;
  let holdReads = false;
  const io = {
    get: async (key: string) => {
      const at = space;
      if (holdReads)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      return stored.get(`${at}/${key}`) ?? null;
    },
    set: async (key: string, value: string | null) => {
      writes.push(`${space}/${key}=${value}`);
      if (value === null) stored.delete(`${space}/${key}`);
      else stored.set(`${space}/${key}`, value);
      return value;
    },
  };
  return {
    seeder: createTimezoneSeeder(io),
    io,
    writes,
    stored,
    switchTo: (next: string) => {
      space = next;
    },
    hold: () => {
      holdReads = true;
    },
    release: () => {
      holdReads = false;
      releaseRead?.();
    },
  };
}

const input = (scope: string, over = {}) => ({
  scope,
  detected: "America/Bogota",
  ...over,
});

describe("seeding the timezone", () => {
  test("saves the detected zone once when the person has none", async () => {
    const h = harness();
    expect(await h.seeder.seed(input("ana:personal"))).toEqual({
      kind: "seeded",
      timezone: "America/Bogota",
      source: "detected",
    });
    expect(await h.seeder.seed(input("ana:personal"))).toEqual({
      kind: "stored",
      timezone: "America/Bogota",
    });
    expect(h.writes).toEqual([
      `personal/${TIMEZONE_PREFERENCE}=America/Bogota`,
    ]);
  });

  test("never overwrites a stored zone; a blank one is unset", async () => {
    const h = harness({ "personal/timezone": "Europe/Madrid" });
    expect(await h.seeder.seed(input("ana:personal"))).toEqual({
      kind: "stored",
      timezone: "Europe/Madrid",
    });
    const blank = harness({ "personal/timezone": "  " });
    expect((await blank.seeder.seed(input("ana:personal"))).kind).toBe(
      "seeded",
    );
    expect(h.writes).toEqual([]);
  });

  test("lifts this device's old zone before the detected one", async () => {
    const h = harness();
    expect(
      await h.seeder.seed(input("ana:personal", { legacy: "Asia/Tokyo" })),
    ).toEqual({ kind: "seeded", timezone: "Asia/Tokyo", source: "legacy" });
  });

  test("seeds again for a new person or space; concurrent seeds share one read", async () => {
    const h = harness({ "personal/timezone": "Europe/Madrid" });
    const [a, b] = await Promise.all([
      h.seeder.seed(input("ana:personal")),
      h.seeder.seed(input("ana:personal")),
    ]);
    expect(a).toEqual(b);
    h.switchTo("team");
    expect((await h.seeder.seed(input("ana:team"))).kind).toBe("seeded");
    expect(h.writes).toEqual(["team/timezone=America/Bogota"]);
  });

  test("a read that outlives a space switch never writes into the new space", async () => {
    const h = harness({ "team/timezone": "Europe/Madrid" });
    let current = "ana:personal";
    h.hold();
    const pending = h.seeder.seed(
      input("ana:personal", { isCurrent: () => current === "ana:personal" }),
    );
    await Promise.resolve();
    // The person switches to the team while the personal read is in flight.
    current = "ana:team";
    h.switchTo("team");
    h.release();
    expect(await pending).toEqual({ kind: "superseded" });
    expect(h.writes).toEqual([]);
    expect(h.stored.get("team/timezone")).toBe("Europe/Madrid");
    // Nothing was cached for the old scope: it reads again next time.
    current = "ana:personal";
    h.switchTo("personal");
    expect((await h.seeder.seed(input("ana:personal"))).kind).toBe("seeded");
  });

  test("an explicit write is read back, not the cached seed", async () => {
    const h = harness();
    await h.seeder.seed(input("ana:personal"));
    await h.io.set("timezone", "Europe/Lisbon");
    h.seeder.forget();
    expect(await h.seeder.seed(input("ana:personal"))).toEqual({
      kind: "stored",
      timezone: "Europe/Lisbon",
    });
  });
});
