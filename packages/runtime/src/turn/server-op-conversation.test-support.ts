import { rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LocalDirStore } from "@houston/runtime-client/object-sync";
import { afterEach } from "vitest";
import {
  fakePoolStore,
  HEARTBEAT_URL,
  POOL_STORE_URL,
} from "./pool-store.test-support";
import { createTurnServer } from "./server";

export const AGENT = "workspaces/Personal/Probe";
export const RUNTIME = `${AGENT}/.houston/runtime`;
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

export async function opWorker(transcriptStatus = 200) {
  const pool = fakePoolStore("ws/org/agent", transcriptStatus);
  pool.put(`${AGENT}/CLAUDE.md`, "# Probe\n");
  const server: Server = createTurnServer({
    store: new LocalDirStore(pool.root),
    token: "",
    runTurn: async () => ({}),
    poolStoreUrl: POOL_STORE_URL,
    fetchImpl: pool.fetchImpl,
  });
  cleanups.push(() => {
    server.close();
    rmSync(pool.root, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (op: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${base}/op`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "org",
          agentId: "agent",
          agentName: "Probe",
          gcsPrefix: "ws/org/agent",
          hostToken: "host-token",
          claim: {
            id: "1",
            token: "1",
            bootId: "boot",
            heartbeatUrl: HEARTBEAT_URL,
          },
          triggersEnabled: false,
          op,
        }),
      });
      const reply = (await res.json()) as {
        status?: number;
        body?: string;
        ambiguous?: boolean;
        error?: string;
        decline?: boolean;
      };
      if (reply.error !== "worker_full" || attempt > 40) return reply;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return { pool, post };
}

export const conversation = {
  id: "c1",
  title: "Chat",
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { role: "user" as const, content: "kept", ts: 1, turnId: "t1" },
    { role: "assistant" as const, content: "reply", ts: 2, turnId: "t1" },
    { role: "user" as const, content: "cut", ts: 3, turnId: "t2" },
    { role: "assistant" as const, content: "cut reply", ts: 4, turnId: "t2" },
  ],
  claudeCompaction: { summary: "old", createdAt: 1 },
};
