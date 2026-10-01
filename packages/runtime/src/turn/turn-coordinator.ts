import { join } from "node:path";
import { substituteApprovals } from "@houston/host/src/assistant/approval-presentation";
import { runAsCoordinator } from "@houston/host/src/assistant/coordinator-scope";
import { liveTurns } from "@houston/host/src/routes/live-turn";
import { LocalWorkspaceStore } from "@houston/host/src/store/local";
import { PrefixedVfs } from "@houston/host/src/vfs";
import type { WireFrame } from "@houston/runtime-client";
import type { ObjectStore } from "@houston/runtime-client/object-sync";
import { engineAgentId } from "./op-scope";
import { openTurnApprovals, type TurnApprovals } from "./turn-approvals";
import { receiveTurnMessage } from "./turn-coordinator-message";
import {
  type CoordinatorServer,
  listenCoordinator,
} from "./turn-coordinator-server";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnRequest } from "./types";

/**
 * Everything a pooled Houston turn has that a standing assistant pod's host
 * gives its runtime: the live-turn record the host's plan and grant gates
 * read, the approval records (answered by this turn's message before the
 * model runs), the operation and mission routes, and the host's own
 * re-rendering of approval cards on the frames leaving the turn.
 */
export interface TurnCoordinatorSession {
  /** Serves an assistant or mission route; null for any other path. */
  route(path: string, init?: RequestInit): Promise<Response> | null;
  /** The frame as the host would show it: cards from their records. */
  present(frame: WireFrame): WireFrame;
  dispose(): Promise<void>;
}

export interface TurnCoordinatorInput {
  turn: TurnRequest;
  /** The person this Houston belongs to (the gateway bound the token to them). */
  ownerId: string;
  token: string;
  gatewayUrl: string;
  agentSlug: string;
  store: ObjectStore;
  prefix: string;
  filesystem: TurnFilesystem;
  fetchImpl?: typeof fetch;
}

const MISSIONS = /^\/sandbox\/missions([/?]|$)/;

const unavailable = () =>
  Response.json(
    {
      error:
        "Houston's approvals could not be read, so nothing that needs one can run this turn",
      code: "approvals_unavailable",
    },
    { status: 503 },
  );

export function startTurnCoordinator(
  input: TurnCoordinatorInput,
): TurnCoordinatorSession {
  const { turn, filesystem } = input;
  const agentId = engineAgentId(filesystem);
  const workspaceId = agentId.split("/")[0] ?? agentId;
  const conversationId = turn.conversationId;
  const scope = {
    userId: input.ownerId,
    agentSlug: input.agentSlug,
    gateway: { url: input.gatewayUrl, token: input.token },
  };
  liveTurns.start(agentId, conversationId, turn.mode ?? "execute", {
    ...(turn.actingToken ? { actingAs: turn.actingToken } : {}),
    actingUser: input.ownerId,
  });
  let opened: TurnApprovals | undefined;
  const ready = runAsCoordinator(scope, () =>
    openTurnApprovals(
      {
        store: input.store,
        prefix: input.prefix,
        filesystem,
        agentId,
        conversationId,
      },
      (approvals) => receiveTurnMessage(approvals, agentId, turn),
    ),
  ).then(
    (approvals) => {
      opened = approvals;
      return approvals;
    },
    (error: unknown) => {
      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : "error";
      console.error(`[turn-coordinator] approvals unavailable (${detail})`);
      return null;
    },
  );
  const missionStore = new LocalWorkspaceStore(
    join(filesystem.storeRoot, "workspaces"),
  );
  const vfs = new PrefixedVfs(filesystem.vfs, "workspaces");
  let server: Promise<CoordinatorServer> | undefined;
  const listen = () => {
    server ??= listenCoordinator({
      scope,
      claim: { workspaceId, agentId },
      assistant: async () => {
        const approvals = await ready;
        if (!approvals) throw new Error("approvals unavailable");
        return {
          store: missionStore,
          vfs,
          approvals: approvals.approvals,
          // Behind the gateway the whole catalogued surface is served.
          unservedOperations: () => new Set<string>(),
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        };
      },
      missions: { store: missionStore, vfs, channels: {} },
    });
    return server;
  };
  const forward = async (path: string, init?: RequestInit) => {
    const assistant = path.startsWith("/sandbox/assistant/");
    if (assistant && !(await ready)) return unavailable();
    const { origin, token } = await listen();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    const res = await fetch(`${origin}${path}`, {
      method: init?.method ?? "GET",
      headers,
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (!assistant) return res;
    const body = await res.arrayBuffer();
    try {
      // A card raised, answered or spent is durable before the tool hears.
      await (await ready)?.save();
    } catch (error) {
      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : "error";
      console.error(`[turn-coordinator] approvals not saved (${detail})`);
      // A card nobody can answer must not be shown; a call that already ran
      // still reports what it did.
      if (path.endsWith("/pending")) return unavailable();
    }
    return new Response(body, { status: res.status, headers: res.headers });
  };
  return {
    route: (path, init) =>
      path.startsWith("/sandbox/assistant/") || MISSIONS.test(path)
        ? forward(path, init)
        : null,
    present: (frame) =>
      opened && (frame.type === "done" || frame.type === "sync")
        ? // SAFETY: substitution only rewrites question steps inside the
          // frame; every other field and the frame's own shape pass through.
          (substituteApprovals(
            frame,
            opened.approvals,
            agentId,
            conversationId,
          ) as WireFrame)
        : frame,
    async dispose() {
      liveTurns.end(agentId, conversationId);
      await ready;
      if (server) await (await server).close();
    },
  };
}
