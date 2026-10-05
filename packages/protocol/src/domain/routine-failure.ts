// Why routine runs fail, and why the engine pauses a routine that keeps failing.

/**
 * Why a routine run failed at the credential level (PRODUCT-1475). A routine
 * fires on its CREATOR's credential scope, so the person reading the run's
 * history may have their own account connected and still see it fail — the run
 * has to name whose account is the problem, and what the remedy is.
 *
 * `creator_*` = the routine creator's own account; `team_*` = the space's
 * single shared account. `out_of_credits` is a VALID credential with no quota
 * left, which reconnecting would not fix. `model_unavailable` = the account
 * works but cannot run the model the routine uses; picking another model fixes
 * it.
 */
export type RoutineRunFailureCode =
  | "creator_not_connected"
  | "team_not_connected"
  | "creator_needs_reconnect"
  | "team_needs_reconnect"
  | "out_of_credits"
  | "model_unavailable";

export interface RoutineRunFailure {
  code: RoutineRunFailureCode;
  /** The provider id the run needed (e.g. "anthropic"). */
  provider: string;
}

/** Delivery failures never contribute to credential auto-pause streaks. */
export type RoutineDeliveryFailureCode = "pool_delivery_expired";

export interface RoutineDeliveryFailure {
  code: RoutineDeliveryFailureCode;
}

/**
 * Why the engine paused a routine (see `Routine.auto_paused`). Every one of the
 * last `failures` runs failed with the same `reason`, so firing again would
 * only fail again until someone fixes the account or the model it runs on.
 */
export interface RoutineAutoPause {
  /** The failure each of the counted runs hit. */
  reason: RoutineRunFailureCode;
  /** The provider id those runs needed (e.g. "anthropic"). */
  provider: string;
  /** How many runs in a row failed that way. */
  failures: number;
  /** ISO time the engine paused the routine. */
  at: string;
}
