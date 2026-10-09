/**
 * A pooled turn that failed before any provider work: the worker answers it
 * with one terminal `error` frame whose `data.code` names the failure (the
 * runtime's `TurnSetupCode`). Older workers put the bare code in
 * `data.message` instead. Nothing of the turn ran and nothing was saved.
 *
 * `claim_fenced` is deliberately NOT one: it ends a turn that may already
 * have streamed and run tools (a durability outcome), so it never reads as
 * "nothing ran".
 *
 *  - `hydrate_over_cap`: the agent's stored data is over the worker's cap.
 *  - `layout_unexpected`: the agent's stored tree is not a layout it knows.
 *  - `agent_not_migrated`: the agent still holds a pre-v0.4 layout.
 *  - `message_refused`: the send reused a nonce for other words.
 *  - `credential_write_failed`: the turn's provider credential never landed.
 *
 * Additive to protocol v3: the frame keeps its required `message`.
 */
export type TurnSetupCode =
  | "hydrate_over_cap"
  | "layout_unexpected"
  | "agent_not_migrated"
  | "message_refused"
  | "credential_write_failed";

export interface TurnSetupFailure {
  code: TurnSetupCode;
  /** The worker's diagnostic text. For logs only, never shown to a person. */
  detail?: string;
}

const CODES: readonly string[] = [
  "hydrate_over_cap",
  "layout_unexpected",
  "agent_not_migrated",
  "message_refused",
  "credential_write_failed",
];

const asCode = (value: unknown): TurnSetupCode | null =>
  typeof value === "string" && CODES.includes(value)
    ? (value as TurnSetupCode)
    : null;

/** The setup failure an `error` frame's `data` carries, or null. */
export function parseTurnSetupFailure(data: unknown): TurnSetupFailure | null {
  if (typeof data !== "object" || data === null) return null;
  const value = data as Record<string, unknown>;
  const code = asCode(value.code) ?? asCode(value.message);
  if (!code) return null;
  return typeof value.detail === "string"
    ? { code, detail: value.detail }
    : { code };
}
