import { readUnservedOperations } from "@houston/domain/assistant-deployment";

/**
 * The API-key operations: a deployment that serves them is one whose people
 * can call their AI Employees through the Houston API (only the hosted gateway
 * does). Names from the catalog; a test pins that they still exist there.
 */
export const HOUSTON_API_KEY_OPERATIONS = [
  "listApiKeys",
  "createApiKey",
  "revokeApiKey",
] as const;

/**
 * Whether THIS deployment serves the Houston API, read off the same unserved
 * stamp the capability map is narrowed by: a desktop host stamps the API-key
 * operations as unserved, the gateway stamps nothing. Fail open like the stamp
 * itself: nothing stamped means everything is served.
 *
 * The coordinator's rules and `request_hands_on` both ask this, so a manager
 * on a deployment without the API neither pitches it nor queues a card for a
 * screen that is not there.
 */
export function houstonApiServedHere(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const unserved = readUnservedOperations(env);
  return !HOUSTON_API_KEY_OPERATIONS.some((name) => unserved.has(name));
}
