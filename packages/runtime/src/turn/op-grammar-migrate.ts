/**
 * Run the host's boot migrations over an agent's store prefix, the work a
 * managed pod's boot did (op-migrate.ts). Leaf module: op-grammar imports
 * it, so it may not import op-grammar back.
 */
export interface MigrateOp {
  kind: "migrate";
  /** The store version the gateway wants the agent at. A worker that knows
   *  an older one refuses rather than claim a version it cannot reach. */
  version: number;
  /** The org owner's user id, stamped on routines that name no creator
   *  (a managed pod's HOUSTON_USER_ID). */
  ownerSub?: string;
}

export function parseMigrateOp(raw: Record<string, unknown>): MigrateOp {
  const { version, ownerSub } = raw;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Error("invalid 'op.version'");
  if (ownerSub !== undefined && (typeof ownerSub !== "string" || !ownerSub))
    throw new Error("invalid 'op.ownerSub'");
  return {
    kind: "migrate",
    version,
    ...(typeof ownerSub === "string" ? { ownerSub } : {}),
  };
}
