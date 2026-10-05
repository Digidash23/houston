import type { ServerResponse } from "node:http";
import { json } from "./http";

/**
 * Fail closed on agent-data writes once this pod has lost its object-store
 * write fence (PRODUCT-1706).
 *
 * A managed pod claims a per-agent write lease at boot; when a NEWER boot
 * takes it (a roll's replacement pod, a pool worker running the agent while
 * the registry called it asleep), the store answers this pod's syncs with 409
 * and the sync daemon halts for good — by design, it is no longer the writer.
 * But the gateway kept proxying to the pod, and the pod kept answering
 * routine/mission/config writes with 200: they landed on its own disk, showed
 * in every read served by that pod, and were gone the moment the pod was
 * recycled and the next one hydrated the store's copy. A routine edited to
 * 7:00 fired at 7:00 for days, then silently reverted to its old 11:30.
 *
 * The write is refused instead. The 503 carries a distinct reason (not the
 * gateway's waking shape), so the client shows its authored "couldn't save"
 * copy and reports it: a fenced pod still receiving writes is a bug we want
 * to see, never a quiet retry loop. The pod then retires (local/fence-retire.ts)
 * so the agent converges on one writer, where the next try lands.
 */

export const STORE_FENCED_ERROR =
  "this agent's data can't be saved right now: a newer engine owns it, try again in a moment";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Runtime-tool write families that land in the agent's synced tree: routines,
 * learnings, missions (the board), and the custom-integration definitions the
 * agent adds or removes (custom-integrations.json).
 */
const SANDBOX_WRITE =
  /^\/sandbox\/(routines|learnings|missions|integrations\/custom\/(add|remove))(\/|$)/;

/**
 * Whether a request would write agent data. `scope` follows the server's
 * ordering: the sandbox families are gated before their HMAC routes, every
 * authenticated mutation only after the bearer has been verified (an
 * anonymous caller must keep getting 401, not a hint about pod state). Not
 * only `/agents/`: an agent's colour, delegation, custom integrations,
 * workspace and preferences all land in the synced tree too.
 */
export function isFencedWrite(
  method: string,
  path: string,
  scope: "sandbox" | "authenticated",
): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  if (scope === "sandbox") return SANDBOX_WRITE.test(path);
  return true;
}

let reported = false;

/**
 * Answer 503 and resolve true when the write must be refused: the sync has
 * already met the fence, or the store's lease check says another boot owns
 * the agent now. The check runs before the write is applied, so a pod
 * superseded while idle refuses the edit instead of acknowledging it.
 */
export async function handleStoreFenceGate(
  deps: {
    storeFenced?: () => boolean;
    storeWritable?: () => Promise<boolean>;
    storeSyncAfterWrite?: () => void;
  },
  method: string,
  path: string,
  res: ServerResponse,
  scope: "sandbox" | "authenticated",
): Promise<boolean> {
  if (!isFencedWrite(method, path, scope)) return false;
  if (!deps.storeFenced?.() && (await deps.storeWritable?.()) !== false) {
    // Upload the write right after it is acknowledged, while the lease the
    // check just saw is still this boot's: left for the periodic pass, it
    // would be lost to a takeover landing in the next five minutes.
    const ship = deps.storeSyncAfterWrite;
    if (ship) {
      res.once("finish", () => {
        if (res.statusCode < 400) ship();
      });
    }
    return false;
  }
  if (!reported) {
    // Once per process: the fence loss itself is logged as a breadcrumb by
    // the sync daemon; a REFUSED write is the moment a user's edit would
    // have been lost, and reports. The pod retires right after.
    reported = true;
    console.error(
      `[local-host] refusing ${method} ${path}: the object-store write fence was lost; this pod's writes would not persist`,
    );
  }
  json(res, 503, { error: STORE_FENCED_ERROR, code: "store_fenced" });
  return true;
}

/** Test seam: forget the once-per-process report. */
export function resetStoreFenceReport(): void {
  reported = false;
}
