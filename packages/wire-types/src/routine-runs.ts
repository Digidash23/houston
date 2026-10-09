/** Routine run rows (protocol v3). Re-exported from `./types`. */

import type {
  RoutineDeliveryFailure,
  RoutineRunFailure,
} from "@houston/protocol";

export type RoutineRunStatus =
  | "running"
  | "silent"
  | "surfaced"
  | "error"
  | "cancelled";

export interface RoutineRun {
  id: string;
  routine_id: string;
  status: RoutineRunStatus;
  session_key: string;
  activity_id?: string;
  summary?: string;
  started_at: string;
  completed_at?: string;
  /** Human-readable reset hint while the provider CLI is sleeping on a
   *  usage-limit window. Only meaningful when status is `running`. */
  paused_until?: string;
  /** Typed reason an `error` run failed on the account or model it needed.
   *  Other failures after a run starts carry their story in `summary`. */
  failure?: RoutineRunFailure;
  /** Cloud never started the run (deadline passed, or the creator lost access). */
  delivery_failure?: RoutineDeliveryFailure;
  /** The engine restarted and is repeating this run. */
  resumed?: true;
}

export interface RoutineRunUpdate {
  status?: RoutineRunStatus;
  activity_id?: string;
  summary?: string;
  completed_at?: string;
  /** Pass `string` to set the hint, `null` to clear, omit to leave alone. */
  paused_until?: string | null;
  resumed?: true;
}
