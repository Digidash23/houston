import { notStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  metalEngravingPath,
  metalEngravingSeed,
} from "../src/metal-engraving.ts";

const lines = (path: string) => (path.match(/M/g) ?? []).length;

describe("metal engraving", () => {
  it("reproduces the same fingerprint for the same inputs", () => {
    const seed = metalEngravingSeed("forest", "Finance manager");
    strictEqual(metalEngravingSeed("forest", "Finance manager"), seed);
    strictEqual(metalEngravingPath(seed), metalEngravingPath(seed));
  });

  it("distinguishes inputs and ambiguous concatenations", () => {
    const fingerprints = new Set(
      ["forest", "charcoal", "golden"].flatMap((color) =>
        ["Finance", "Operations", "Assistant"].map((role) =>
          metalEngravingPath(metalEngravingSeed(color, role)),
        ),
      ),
    );
    strictEqual(fingerprints.size, 9);
    notStrictEqual(
      metalEngravingSeed("ab", "c"),
      metalEngravingSeed("a", "bc"),
    );
  });

  it("bounds geometry and work even with empty or Unicode inputs", () => {
    for (const role of ["", "Operações", "財務", "x".repeat(1000)]) {
      const path = metalEngravingPath(metalEngravingSeed("navy", role));
      strictEqual(lines(path), 64);
      strictEqual((path.match(/L/g) ?? []).length, 64 * 24);
      ok(path.length < 30000);
      ok(!/NaN|Infinity/.test(path));
      const coordinates = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)];
      ok(
        coordinates.every(
          ([, x, y]) =>
            Number(x) >= 0 && Number(x) <= 360 && Math.abs(Number(y)) < 300,
        ),
      );
    }
  });
});
