import type { ServerResponse } from "node:http";
import { ConversationProjectionError } from "./op-durability";
import { WorkerOpDeclinedError } from "./op-provider-guard";
import type { OpRequest } from "./parse-op-request";
import { TurnSetupError } from "./turn-layout";

export function answerOpFailure(
  res: ServerResponse,
  op: OpRequest,
  error: unknown,
): void {
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TurnSetupError && error.code === "agent_not_migrated") {
    // Nothing was written: the gateway runs the agent's `migrate` op (an
    // older gateway proxies to the pod, whose boot migrates), never a
    // write that would hide the flat files from that migration.
    console.warn(`[op] declined kind=${op.op.kind}: ${message}`);
    if (!res.headersSent)
      json(res, 200, { ok: true, decline: true, reason: error.code });
    return;
  }
  if (error instanceof WorkerOpDeclinedError) {
    console.warn(`[op] declined kind=${op.op.kind}: ${message}`);
    if (!res.headersSent) json(res, 200, { ok: true, decline: true });
    return;
  }
  // Loud: a 500 here is the gateway's "worker_500" with no other trace.
  console.error(
    `[op] failed kind=${op.op.kind} ${op.op.kind === "route" ? `${op.op.method} ${op.op.rest}` : ""}: ${message}`,
  );
  if (!res.headersSent) {
    if (error instanceof ConversationProjectionError)
      json(res, 200, { ok: true, ambiguous: true });
    else json(res, 500, { error: message });
  }
}
