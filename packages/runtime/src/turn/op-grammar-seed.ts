import { invalidAgentNameMessage, validateAgentName } from "@houston/domain";
import { asSeedRecord, safeSeedKey } from "@houston/host/src/routes/agent-seed";

/**
 * Create a brand-new agent's tree in its empty store prefix, the files the
 * pod's `POST /agents` would write (see op-seed.ts for adopt/refuse). Leaf
 * module: op-grammar imports it, so it may not import op-grammar back.
 */
export interface SeedOp {
  kind: "seed";
  /** Trimmed by the domain validator, as the pod's create stores it. */
  name: string;
  claudeMd?: string;
  seeds?: Record<string, string>;
  /** The gateway's "first provisioning" flag: an adopt republishes the docs
   *  a crashed first seed may never have projected (op-seed.ts). */
  republish?: true;
}

export function parseSeedOp(raw: Record<string, unknown>): SeedOp {
  if (typeof raw.name !== "string") throw new Error("invalid 'op.name'");
  const name = validateAgentName(raw.name);
  if (!name.ok) throw new Error(invalidAgentNameMessage(name.reason));
  if (raw.claudeMd !== undefined && typeof raw.claudeMd !== "string")
    throw new Error("invalid 'op.claudeMd'");
  let seeds: Record<string, string> | undefined;
  if (raw.seeds !== undefined) {
    const parsed = asSeedRecord(raw.seeds);
    if (!parsed) throw new Error("invalid 'op.seeds'");
    // The pod throws the same message mid-create (a 500 after rollback);
    // refused here it is a deterministic 400 the gateway never retries.
    for (const key of Object.keys(parsed))
      if (!safeSeedKey(key)) throw new Error(`unsafe seed path: ${key}`);
    seeds = parsed;
  }
  return {
    kind: "seed",
    name: name.name,
    ...(typeof raw.claudeMd === "string" ? { claudeMd: raw.claudeMd } : {}),
    ...(seeds ? { seeds } : {}),
    ...(raw.republish === true ? { republish: true as const } : {}),
  };
}
