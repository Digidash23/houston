import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { executeMigrateOp } from "./op-migrate";
import type { OpClaimTurn } from "./op-republish";
import { executeSeedOp } from "./op-seed";
import type { OpRequest } from "./parse-op-request";
import type { TurnServerDeps } from "./server-types";

/** The worker's HTTP answer to `/op` for an op that owns its tree. */
export interface OwnTreeReply {
  status: number;
  body: unknown;
}

/**
 * The ops that read and write the store themselves instead of through the
 * shared claimed hydrate: a seed (decided from the listing before any tree
 * exists) and a migrate (the one op allowed over a tree the shared hydrate
 * refuses, turn-layout-legacy.ts). null for every other kind.
 */
export function executeOwnTreeOp(input: {
  deps: TurnServerDeps;
  op: OpRequest;
  turn: OpClaimTurn;
  store: ObjectStore;
  prefix: string;
  root: string;
  fenced: () => Promise<boolean>;
}): Promise<OwnTreeReply> | null {
  const { op } = input;
  if (op.op.kind === "seed")
    return executeSeedOp({ ...input, op: { ...op, op: op.op } });
  if (op.op.kind === "migrate")
    return executeMigrateOp({ ...input, op: { ...op, op: op.op } });
  return null;
}
