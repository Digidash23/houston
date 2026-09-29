import { describe, expect, test } from "vitest";
import {
  bashMemoryFencePrefix,
  CGROUP_MEMORY_LIMIT_FILES,
  CHILD_MEMORY_CAP_FLOOR_BYTES,
  childMemoryCapBytes,
  parseCgroupMemoryLimit,
  readCgroupMemoryLimit,
} from "./child-memory-fence";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe("parseCgroupMemoryLimit", () => {
  test("a numeric limit is bytes", () => {
    expect(parseCgroupMemoryLimit("2147483648\n")).toBe(2 * GiB);
  });

  test("cgroup v2 'max' and the v1 no-limit sentinel mean no limit", () => {
    expect(parseCgroupMemoryLimit("max\n")).toBeNull();
    expect(parseCgroupMemoryLimit("9223372036854771712\n")).toBeNull();
  });

  test("unreadable or malformed content means no limit, never a throw", () => {
    expect(parseCgroupMemoryLimit(null)).toBeNull();
    expect(parseCgroupMemoryLimit("")).toBeNull();
    expect(parseCgroupMemoryLimit("-1")).toBeNull();
    expect(parseCgroupMemoryLimit("0")).toBeNull();
    expect(parseCgroupMemoryLimit("lots")).toBeNull();
  });
});

describe("readCgroupMemoryLimit", () => {
  test("prefers the unified hierarchy and falls back to the v1 controller", () => {
    const v2Only = (path: string) =>
      path === CGROUP_MEMORY_LIMIT_FILES[0] ? "3221225472" : null;
    expect(readCgroupMemoryLimit(v2Only, "linux")).toBe(3 * GiB);

    const v1Only = (path: string) =>
      path === CGROUP_MEMORY_LIMIT_FILES[1] ? "1073741824" : null;
    expect(readCgroupMemoryLimit(v1Only, "linux")).toBe(1 * GiB);
  });

  test("a v2 'max' still lets a real v1 limit through", () => {
    const read = (path: string) =>
      path === CGROUP_MEMORY_LIMIT_FILES[0] ? "max" : "1073741824";
    expect(readCgroupMemoryLimit(read, "linux")).toBe(1 * GiB);
  });

  test("no readable limit means no limit", () => {
    expect(readCgroupMemoryLimit(() => null, "linux")).toBeNull();
  });

  test("never reads on a non-Linux platform", () => {
    let reads = 0;
    const read = () => {
      reads++;
      return "2147483648";
    };
    expect(readCgroupMemoryLimit(read, "darwin")).toBeNull();
    expect(readCgroupMemoryLimit(read, "win32")).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("childMemoryCapBytes", () => {
  test("is the container limit minus the engine reserve", () => {
    expect(childMemoryCapBytes(2 * GiB, 1280 * MiB)).toBe(768 * MiB);
    expect(childMemoryCapBytes(4 * GiB, 1280 * MiB)).toBe(2816 * MiB);
  });

  test("never drops below the floor, even in a tiny container", () => {
    expect(childMemoryCapBytes(1 * GiB, 1280 * MiB)).toBe(
      CHILD_MEMORY_CAP_FLOOR_BYTES,
    );
  });

  test("no container limit means no cap", () => {
    expect(childMemoryCapBytes(null, 1280 * MiB)).toBeNull();
  });
});

describe("the fence shell lines", () => {
  test("the prefix applies RLIMIT_DATA in 1024-byte blocks, quietly", () => {
    expect(bashMemoryFencePrefix(768 * MiB)).toBe(
      "ulimit -d 786432 2>/dev/null",
    );
  });
});
