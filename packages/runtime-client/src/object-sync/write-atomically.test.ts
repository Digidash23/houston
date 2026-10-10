import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicTempPath } from "@houston/protocol";
import { expect, test, vi } from "vitest";

const FIXED_ID = "00000000-0000-4000-8000-000000000000";
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomUUID: () => FIXED_ID,
}));

const { writeAtomically } = await import("./http-store-batch");

const posixTest = process.platform === "win32" ? test.skip : test;

posixTest(
  "a planted symlink at the temp path is never written through",
  async () => {
    const work = mkdtempSync(join(tmpdir(), "houston-wx-"));
    const outside = join(mkdtempSync(join(tmpdir(), "houston-out-")), "victim");
    writeFileSync(outside, "untouched");
    const dest = join(work, "notes.txt");
    symlinkSync(outside, atomicTempPath(dest, FIXED_ID));
    await expect(
      writeAtomically(dest, Buffer.from("new")),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(outside, "utf8")).toBe("untouched");
    expect(readdirSync(work)).toEqual([]);
  },
);
