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
export type RoutineAccountFailureCode =
  | "creator_not_connected"
  | "team_not_connected"
  | "creator_needs_reconnect"
  | "team_needs_reconnect"
  | "out_of_credits"
  | "model_unavailable";

/**
 * Every typed reason a routine run failed. `no_model`: the routine names no
 * model (it predates per-routine models, PRODUCT-1982) and the account it runs
 * as has no usable provider to fall back on, so there is no provider to name;
 * choosing a model for the routine fixes it.
 */
export type RoutineRunFailureCode = RoutineAccountFailureCode | "no_model";

export type RoutineRunFailure =
  | {
      code: RoutineAccountFailureCode;
      /** The provider id the run needed (e.g. "anthropic"). */
      provider: string;
    }
  | { code: "no_model" };

/** Delivery failures never contribute to credential auto-pause streaks. */
export type RoutineDeliveryFailureCode = "pool_delivery_expired";

export interface RoutineDeliveryFailure {
  code: RoutineDeliveryFailureCode;
}

/**
 * Why the engine paused a routine (see `Routine.auto_paused`). Every one of the
 * last `failures` runs failed with the same `reason`, so firing again would
 * only fail again until someone fixes the account or the model it runs on.
 * `provider` is present exactly when the reason names an account.
 */
export type RoutineAutoPause = {
  /** How many runs in a row failed that way. */
  failures: number;
  /** ISO time the engine paused the routine. */
  at: string;
} & (
  | {
      /** The failure each of the counted runs hit. */
      reason: RoutineAccountFailureCode;
      /** The provider id those runs needed (e.g. "anthropic"). */
      provider: string;
    }
  | { reason: "no_model" }
);
