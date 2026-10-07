import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBack } from "@houston/runtime-client/object-sync";
import { expect } from "vitest";
import { applyOp } from "./op-apply";
import { projectDurableOp } from "./op-durability";
import { opClaimId, opTreeOptions } from "./op-tree-options";
import { parseOpRequest } from "./parse-op-request";
import { prepareTurnFilesystem } from "./turn-filesystem";
import {
  type AgentStore,
  docDeps,
  type PodDocs,
  PREFIX,
} from "./turn-views.test-support";

/**
 * A sleeping agent's ops over the store `turn-views.test-support.ts` builds:
 * the gateway envelope, applied the way executeOp applies it.
 */

let claimOrigin: Promise<string> | undefined;

/** The op claim's origin, which also serves the custom-integration secrets
 *  store: every request answers `200 {}` (no secret held). */
function localClaimOrigin(): Promise<string> {
  claimOrigin ??= new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("{}");
    });
    server.unref();
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });
  return claimOrigin;
}

/** One route op parsed from the gateway's envelope (`extra` rides on top). */
async function routeOp(
  route: { method: string; rest: string; body?: unknown },
  extra: Record<string, unknown> = {},
) {
  return parseOpRequest({
    workspaceId: "w1",
    agentId: "agent-1",
    gcsPrefix: PREFIX,
    hostToken: "host-token",
    claim: {
      id: "ops",
      bootId: "b",
      token: "t",
      heartbeatUrl: `${await localClaimOrigin()}/heartbeat`,
    },
    triggersEnabled: false,
    op: {
      kind: "route",
      method: route.method,
      rest: route.rest,
      contentType: "application/json",
      body: route.body === undefined ? "" : JSON.stringify(route.body),
    },
    ...extra,
  });
}

/** Apply a route op over a fresh hydration of `agent`, without syncing back. */
export async function applyRoute(
  agent: AgentStore,
  route: { method: string; rest: string; body?: unknown },
  extra: Record<string, unknown> = {},
) {
  const op = await routeOp(route, extra);
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root: await mkdtemp(join(tmpdir(), "turn-views-op-")),
    claimed: true,
    ...opTreeOptions(op.op),
  });
  return applyOp(op, filesystem);
}

/**
 * A sleeping agent's op, run the way executeOp runs it (the real
 * handler over a lazy tree, the scoped sync-back), split before its doc
 * projection so a test can interleave a turn's publish. `beforeApply` runs
 * between the op's listing and its handler, `beforeSync` between the
 * handler's write and the sync-back: another writer landing in either makes
 * the op's upload lose its generation race.
 */
export async function landOp(
  agent: AgentStore,
  docs: PodDocs,
  route: { method: string; rest: string; body?: unknown },
  race: {
    beforeApply?: () => Promise<void>;
    beforeSync?: () => Promise<void>;
  } = {},
) {
  const op = await routeOp(route);
  const filesystem = await prepareTurnFilesystem({
    store: agent.store,
    prefix: PREFIX,
    root: await mkdtemp(join(tmpdir(), "turn-views-op-")),
    claimed: true,
    ...opTreeOptions(op.op),
  });
  await race.beforeApply?.();
  const result = await applyOp(op, filesystem);
  expect(result.status, result.body).toBeLessThan(300);
  await race.beforeSync?.();
  const synced = await syncBack(
    agent.store,
    PREFIX,
    filesystem.storeRoot,
    filesystem.manifest,
    {
      include: result.include,
      holdDeletesOnFailure: true,
      generations: filesystem.generationAware,
      workerMerge: true,
    },
  );
  expect(synced.conflicts).toEqual([]);
  return () =>
    projectDurableOp({
      deps: docDeps(docs),
      turn: { ...op, conversationId: opClaimId(op.op) },
      op,
      filesystem,
      result,
      uploaded: synced.uploaded,
      deleted: synced.deleted,
      source: { store: agent.store, prefix: PREFIX },
      prefix: PREFIX,
    });
}
