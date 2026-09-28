import type {
  Agent,
  CreateAgent,
  CreateAgentResult,
} from "@houston/wire-types";
import * as controlPlane from "../control-plane";
import type { AdapterContext } from "./context";
import { viaSdk } from "./sdk-error";

/**
 * Agent create / rename against a control plane: the SDK owns the wire write,
 * the adapter layers the browser-local color overlay onto the returned wire
 * agent, maps it to the UI shape, and keeps the context's known-agent id set
 * (what provider routing validates against) in step with the write.
 */

export async function createAgentViaCp(
  ctx: AdapterContext,
  req: CreateAgent,
): Promise<CreateAgentResult> {
  // Byte-identical POST /agents with the full
  // `{ name, claudeMd?, seeds?, migration? }` body, the initial config folded
  // into the seeds, no refetch. The RETURNED wire agent carries the id the
  // color overlay needs.
  const wire = await viaSdk("/agents", () =>
    ctx.sdk.agents.writes.create({
      name: req.name,
      claudeMd: req.claudeMd,
      seeds: req.seeds,
      config: req.config,
      migration: req.migration,
    }),
  );
  ctx.noteAgentAdded(wire.id);
  return { agent: controlPlane.createdAgentToUi(wire, req.color) };
}

export async function renameAgentViaCp(
  ctx: AdapterContext,
  agentId: string,
  newName: string,
): Promise<Agent> {
  // The SDK owns the PATCH /agents/:id write; the color overlay is carried
  // across the (possibly new) id.
  const wire = await viaSdk(controlPlane.agentPath(agentId), () =>
    ctx.sdk.agents.writes.rename(agentId, newName),
  );
  // A rename mints a new id: the old one 404s from here on, so provider
  // routing must stop naming it (HOUSTON-APP-52F).
  if (wire.id !== agentId) {
    ctx.noteAgentGone(agentId);
    ctx.noteAgentAdded(wire.id);
  }
  return controlPlane.renamedAgentToUi(agentId, wire);
}
