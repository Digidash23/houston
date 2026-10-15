import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Paths no other local user may read: the browser tool's sign-in cookies
 * (`<agent>/.houston/browser/`). A pooled turn's worker runs with umask 002
 * so the model's tool user (same group) can edit the tree it hydrates; a
 * file landed with the default mode there is group read-WRITE. Every site
 * that lands an object on disk creates these with an explicit owner-only
 * mode instead, and keeps their directory owner-only.
 */
const PRIVATE_DIR = /^((?:.*[\\/])?\.houston[\\/]browser)[\\/][^\\/]/i;

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

const WINDOWS = process.platform === "win32";

/** The `.houston/browser` directory holding `file`, when it is under one. */
export function privateDirOf(file: string): string | undefined {
  return PRIVATE_DIR.exec(file)?.[1];
}

/** The `mode` to create `file` (or its atomic temp sibling) with. */
export function landingMode(file: string): { mode?: number } {
  return privateDirOf(file) ? { mode: PRIVATE_FILE_MODE } : {};
}

/** This process's uid; Windows has none and skips the owner check. */
export function currentUid(): number | undefined {
  return WINDOWS ? undefined : process.getuid?.();
}

/** Why `info` is no place for cookies, or null when it is. */
function problemWith(info: Stats, uid: number | undefined): string | null {
  if (info.isSymbolicLink()) return "is a symlink";
  if (!info.isDirectory()) return "is not a directory";
  if (uid !== undefined && info.uid !== uid)
    return `is owned by uid ${info.uid}, not this process (${uid})`;
  return null;
}

/**
 * Check the private directory holding `file` (if any) and make it
 * owner-only. `.houston/` is group-writable for the tool user, who could plant
 * a symlink or their own directory there to catch the cookies: anything but a
 * real directory this process owns is refused (logged, and false: the caller
 * writes nothing). On POSIX the check and the chmod go through ONE
 * no-follow descriptor, so the directory cannot be swapped between them.
 * `uid` is the tests' seam.
 */
export async function closePrivateDir(
  file: string,
  uid: number | undefined = currentUid(),
): Promise<boolean> {
  const dir = privateDirOf(file);
  if (!dir) return true;
  const problem = await privateDirProblem(dir, uid, true);
  if (problem === null) return true;
  console.error(
    `[object-sync] refusing to write sign-in state: ${dir} ${problem}`,
  );
  return false;
}

/**
 * Why `dir` is no place for sign-in state, or null when it is a real
 * directory this process owns. `close` also makes it owner-only, through the
 * same descriptor the check used. A missing directory throws ENOENT.
 */
export async function privateDirProblem(
  dir: string,
  uid: number | undefined = currentUid(),
  close = false,
): Promise<string | null> {
  if (WINDOWS) return problemWith(await lstat(dir), uid);
  return checkThroughDescriptor(dir, uid, close);
}

async function checkThroughDescriptor(
  dir: string,
  uid: number | undefined,
  close: boolean,
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      dir,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // O_NOFOLLOW on a symlink is ELOOP; O_DIRECTORY on a file is ENOTDIR.
    if (code === "ELOOP") return "is a symlink";
    if (code === "ENOTDIR") return "is not a directory";
    // Another user's directory closed to us: refused like any other.
    if (code === "EACCES" || code === "EPERM") return "is not ours to open";
    throw error;
  }
  try {
    const problem = problemWith(await handle.stat(), uid);
    if (problem === null && close) await handle.chmod(PRIVATE_DIR_MODE);
    return problem;
  } finally {
    await handle.close();
  }
}

/**
 * `mkdir -p` the parent of `file`; a private one is created owner-only and
 * checked by {@link closePrivateDir}. False: refused, land nothing.
 */
export async function mkdirForLanding(file: string): Promise<boolean> {
  const dir = privateDirOf(file);
  if (!dir) {
    await mkdir(dirname(file), { recursive: true });
    return true;
  }
  await mkdir(dirname(dir), { recursive: true });
  try {
    await mkdir(dir, { mode: PRIVATE_DIR_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (!(await closePrivateDir(file))) return false;
  await mkdir(dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
  return true;
}
