import type { Routine } from "@houston/protocol";
import {
  ASSISTANT_USER_ID_ENV,
  MANAGED_CLOUD_ENV,
} from "../launcher/assistant-role";

type Env = Record<string, string | undefined>;

/**
 * The person a managed AI Manager pod belongs to, or undefined on any other
 * host. Only that person reaches their manager, so every routine on it is
 * theirs, whatever creator an earlier write recorded.
 */
export function managerOwner(env: Env = process.env): string | undefined {
  if (env[MANAGED_CLOUD_ENV] !== "1") return undefined;
  return env[ASSISTANT_USER_ID_ENV]?.trim() || undefined;
}

/**
 * The identity a managed pod records on a routine write that carries no acting
 * identity, and stamps at boot on routines that name no creator: the
 * manager's own person on an AI Manager pod, the org owner on any other.
 */
export function managedOwnerSub(env: Env = process.env): string | undefined {
  return managerOwner(env) ?? (env.HOUSTON_USER_ID || undefined);
}

/**
 * Whether a fire acting as `actingSub` may run `routine`: its recorded
 * creator may, and on an AI Manager pod so may the manager's own person (the
 * control plane fires every manager routine as that person).
 */
export function actingMayRunRoutine(
  actingSub: string | null | undefined,
  routine: Pick<Routine, "created_by">,
  env: Env = process.env,
): boolean {
  if (!actingSub) return false;
  if (routine.created_by && actingSub === routine.created_by) return true;
  return actingSub === managerOwner(env);
}
