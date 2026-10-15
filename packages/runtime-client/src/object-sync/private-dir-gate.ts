import { privateDirOf, privateDirProblem } from "./private-paths";

/** Refusals already logged: a standing sync re-checks every tick. */
const logged = new Set<string>();

/**
 * A sync pass's verdict on each private directory (private-paths.ts): may
 * the paths under it be uploaded or deleted? `.houston/` is group-writable
 * for a pooled turn's tool user, who could make `.houston/browser` a real
 * directory of their own with a planted `state.json`; uploading it would
 * replace the person's real sign-ins (a create-only conflict retries at the
 * refreshed generation). So the directory must pass the landing check: a
 * real directory this process owns. A missing one passes nothing either: a
 * delete under it would wipe the remote sign-ins. Paths outside any private
 * directory always pass. Refusals are logged once per process.
 *
 * Only a cheap first check for uploads: the tool user can swap the directory
 * right after it, so every upload is checked again per FILE through the
 * descriptor it is read from (sync-back-source.ts). Never cached, so a
 * delete is decided on the directory as it is now, not as it was at the
 * start of the pass.
 *
 * Forgetting sign-ins: deleting `.houston/browser` locally never clears the
 * remote copy. A missing directory passes nothing, so the objects stay in
 * the store and the next hydration lands them again. A future "forget
 * sign-ins" action must delete those objects from the store explicitly.
 */
export function privateDirGate(): (file: string) => Promise<boolean> {
  return async (file) => {
    const dir = privateDirOf(file);
    return dir ? trusted(dir) : true;
  };
}

async function trusted(dir: string): Promise<boolean> {
  let problem: string | null;
  try {
    problem = await privateDirProblem(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    problem = "is missing";
  }
  if (problem === null) return true;
  const line = `${dir} ${problem}`;
  if (!logged.has(line)) {
    logged.add(line);
    console.error(`[object-sync] not syncing sign-in state: ${line}`);
  }
  return false;
}
