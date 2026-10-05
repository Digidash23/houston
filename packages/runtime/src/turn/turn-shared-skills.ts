import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  HttpObjectStore,
  type ObjectMetadata,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";
import { loadSkillsManifest } from "../session/skills-manifest";
import type { TurnStoreConfig } from "./turn-store";
import { poolIdentity } from "./turn-store";
import type { TurnRequest } from "./types";

/**
 * ORG-SHARED SKILLS ON A POOLED TURN.
 *
 * A standing pod mirrors its org's shared skills to disk and hands the mirror
 * to every runtime it spawns (`HOUSTON_SHARED_SKILLS_DIR`); the pi loader then
 * offers the ones the agent's skills manifest enables. A pool worker serves
 * one turn of any org, so nothing about shared skills may live in its process
 * config: each turn reads its own org's shared prefix from the store, with the
 * claim's turn token (pod-store binds that token to exactly one org and agent,
 * so naming another org's prefix is refused there), into a snapshot under the
 * turn's own root, which is deleted with the turn and never synced back.
 *
 * Only the skills the agent enabled are fetched: the loader would drop every
 * other one anyway, and an agent that enabled none reads nothing. The
 * snapshot is READ-ONLY to
 * the turn (fs-guard `readOnlyRoots`): org-shared writes are a standing pod's
 * alone, and an edit made here would silently vanish with the turn.
 */

const SKILLS_PREFIX = "skills/";
/** Parallel reads per turn: a large skill folder must not open a request per file at once. */
const DOWNLOADS_AT_ONCE = 8;
/** How long the snapshot may hold the prompt back before the turn runs without it. */
const SNAPSHOT_DEADLINE_MS = 15_000;

/** Where a pooled turn's shared skills snapshot lives: beside, never in, the synced tree. */
export function turnSharedSkillsDir(turnRoot: string): string {
  return join(turnRoot, "shared-skills");
}

/** The org-shared store a claimed pool turn reads, or null for any other turn. */
export function turnSharedSkillsStore(
  turn: Pick<TurnRequest, "gcsPrefix" | "claim" | "hostToken">,
  config: TurnStoreConfig = {},
): ObjectStore | null {
  const poolStoreUrl =
    config.poolStoreUrl ?? process.env.HOUSTON_POOL_STORE_URL;
  if (!turn.claim || !turn.hostToken || !poolStoreUrl) return null;
  const { org, agent } = poolIdentity(turn.gcsPrefix);
  const root = poolStoreUrl.replace(/\/+$/, "");
  return new HttpObjectStore({
    baseUrl: `${root}/v1/pod/store/${encodeURIComponent(org)}/shared`,
    token: turn.hostToken,
    agentSlug: agent,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });
}

/** The skill folder a shared key belongs to, or null for anything else. */
function skillOf(key: string): string | null {
  if (!key.startsWith(SKILLS_PREFIX)) return null;
  const segments = key.slice(SKILLS_PREFIX.length).split("/");
  if (segments.length < 2 || segments.some((s) => s === "" || s === ".."))
    return null;
  return segments[0] ?? null;
}

/**
 * Fetch the org's shared skills this agent enabled into `dest`. Most agents
 * enable none, and their turns read nothing at all; the rest pay one listing
 * and their skills' files. Never fails the turn: a store failure is reported
 * and the turn runs without them, the way a pod whose mirror pull failed runs
 * on what it has.
 */
export async function snapshotTurnSharedSkills(
  store: ObjectStore | null,
  dest: string,
  workspaceDir: string,
  deadlineMs: number = SNAPSHOT_DEADLINE_MS,
): Promise<void> {
  if (!store?.manifest) return;
  // One stop for every read: the deadline (a stalled store must not hold the
  // prompt back) and the first failure. HTTP reads cancel on it at once, or
  // after at most one retry pause; readers are drained before this returns,
  // so none is left writing into a root the turn then removes.
  const stop = new AbortController();
  const timer = setTimeout(
    () => stop.abort(new Error(`shared skills took over ${deadlineMs} ms`)),
    deadlineMs,
  );
  try {
    const enabled = new Set(loadSkillsManifest(workspaceDir).enabled);
    if (enabled.size === 0) return;
    const root = resolve(dest);
    const listed: ObjectMetadata[] = await Promise.race([
      store.manifest(SKILLS_PREFIX, { signal: stop.signal }),
      new Promise<never>((_resolve, reject) =>
        stop.signal.addEventListener(
          "abort",
          () => reject(stop.signal.reason),
          {
            once: true,
          },
        ),
      ),
    ]);
    const queue = listed.filter((object) => {
      const skill = skillOf(object.key);
      return skill !== null && enabled.has(skill);
    });
    const reader = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        stop.signal.throwIfAborted();
        const rel = next.key.slice(SKILLS_PREFIX.length).split("/");
        const file = resolve(root, ...rel);
        if (!file.startsWith(`${root}${sep}`)) continue;
        await mkdir(dirname(file), { recursive: true, mode: 0o755 });
        await store.download(next.key, file, { signal: stop.signal });
      }
    };
    const readers = await Promise.allSettled(
      Array.from({ length: DOWNLOADS_AT_ONCE }, () =>
        reader().catch((error: unknown) => {
          stop.abort(error);
          throw error;
        }),
      ),
    );
    const failed = readers.find((result) => result.status === "rejected");
    if (failed) throw stop.signal.reason ?? failed.reason;
  } catch (error) {
    console.error(
      "[shared-skills] the turn runs without its org's shared skills:",
      error instanceof Error ? error.message : String(error),
    );
    await clearSnapshot(dest);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Half a skill folder is worse than none: the loader would offer a skill whose
 * reference files never arrived. The directory itself stays, since the file
 * guard was built on it.
 */
async function clearSnapshot(dest: string): Promise<void> {
  try {
    const left = await readdir(dest);
    await Promise.all(
      left.map((entry) =>
        rm(join(dest, entry), { recursive: true, force: true }),
      ),
    );
  } catch (error) {
    console.error(
      "[shared-skills] could not clear a partial snapshot:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
