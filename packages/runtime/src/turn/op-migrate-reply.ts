import type { TurnSetupCode } from "./turn-layout";

/** The worker's HTTP answer to `/op` for a migrate. */
export interface MigrateReply {
  status: number;
  body: unknown;
}

/**
 * Every answer rides the worker's 200 relay envelope; the gateway reads the
 * inner status and body.
 */
export const relayed = (status: number, body: unknown): MigrateReply => ({
  status: 200,
  body: {
    ok: true,
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    events: [],
  },
});

/**
 * The codes a failed migrate answers. The gateway blocks the agent until its
 * store changes on `layout_unexpected` and `hydrate_over_cap`, and backs off
 * on any other (cloud pooldispatch/storemigrate_block.go).
 */
export type MigrateFailureCode =
  | TurnSetupCode
  /** The prefix listed nothing: a momentary listing, not a layout. */
  | "store_empty"
  | "migration_failed"
  | "migration_not_durable";

export const failed = (
  code: MigrateFailureCode,
  detail: Record<string, unknown> = {},
) => relayed(code === "migration_not_durable" ? 409 : 500, { code, ...detail });
