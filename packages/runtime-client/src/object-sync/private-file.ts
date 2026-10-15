import { constants, type Stats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { currentUid } from "./private-paths";

/** One read of a file under a private directory (private-paths.ts). */
export type PrivateFileRead =
  | { kind: "read"; body: Buffer }
  | { kind: "missing" }
  | { kind: "refused"; problem: string };

const WINDOWS = process.platform === "win32";
// Absent on Windows: there the symlink check is an lstat before the open.
const NO_FOLLOW = WINDOWS ? 0 : (constants.O_NOFOLLOW ?? 0);
// A planted FIFO must not hang the open waiting for a writer.
const NON_BLOCK = WINDOWS ? 0 : (constants.O_NONBLOCK ?? 0);

/** Why `info` is not sign-in state this process wrote, or null when it is. */
function problemWith(info: Stats, uid: number | undefined): string | null {
  if (!info.isFile()) return "is not a regular file";
  if (uid !== undefined && info.uid !== uid)
    return `is owned by uid ${info.uid}, not this process (${uid})`;
  // Every writer here lands a temp file and renames it in, so the state file
  // has exactly one name. A second one is a hard link the tool user made to
  // a worker-owned file it can write (umask 002) and swapped in.
  if (info.nlink !== 1) return `has ${info.nlink} hard links`;
  return null;
}

/**
 * Read `file` per FILE, not per directory: `.houston/` is group-writable and
 * not sticky (an agent's atomic rename over a worker-owned file needs that),
 * so the tool user can swap `.houston/browser` between any directory check
 * and a later open by path. The file itself is opened without following a
 * final symlink, then judged through that descriptor (a regular file this
 * process owns) and read through it: nothing re-opens the path. A swapped-in
 * directory can only offer the tool user's own files, which the owner check
 * refuses, or a hard link to one of ours, which the link count refuses. `uid` is the tests' seam.
 */
export async function readPrivateFile(
  file: string,
  uid: number | undefined = currentUid(),
): Promise<PrivateFileRead> {
  let handle: FileHandle;
  try {
    if (NO_FOLLOW === 0 && (await lstat(file)).isSymbolicLink())
      return { kind: "refused", problem: "is a symlink" };
    handle = await open(file, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    // A parent that stopped being a directory was swapped, not emptied.
    if (code === "ENOTDIR")
      return { kind: "refused", problem: "is not under a directory" };
    // O_NOFOLLOW on a symlink: ELOOP on Linux and macOS, EMLINK on FreeBSD.
    if (code === "ELOOP" || code === "EMLINK")
      return { kind: "refused", problem: "is a symlink" };
    if (code === "EACCES" || code === "EPERM")
      return { kind: "refused", problem: "is not ours to open" };
    throw error;
  }
  try {
    const problem = problemWith(await handle.stat(), uid);
    if (problem !== null) return { kind: "refused", problem };
    return { kind: "read", body: await handle.readFile() };
  } finally {
    await handle.close();
  }
}
