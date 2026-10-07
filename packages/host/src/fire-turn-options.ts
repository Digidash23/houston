import type { TurnLimits } from "@houston/protocol";

/**
 * Who a programmatic fire acts as, and the limits it runs under. `actingUser`
 * is the local routine creator's bare `sub`; `actingAs` is a gateway-minted C2
 * token for an externally scheduled fire and replaces the bare header. Both
 * are absent for legacy creator-less local routines. `limits` are the plan
 * limits of the person the work is done for (a mission inherits its parent
 * turn's), recorded on the turn the fire starts.
 */
export interface FireTurnOptions {
  actingUser?: string | undefined;
  actingAs?: string | undefined;
  limits?: TurnLimits | undefined;
}
