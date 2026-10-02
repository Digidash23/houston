import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_STORE_MIGRATION_VERSION } from "@houston/host/src/migrate/agent-store";
import { expect, test } from "vitest";
import type { MigrateOp } from "./op-grammar-migrate";
import { executeMigrateOp } from "./op-migrate";
import {
  docRoute,
  generationStore,
  PREFIX,
  seedRequest,
} from "./op-seed.test-support";
import type { OpRequest } from "./parse-op-request";

/**
 * The migrate op's failure edges: whatever goes wrong, nothing another
 * writer landed is replaced and the agent is left for its fallback and a
 * later run, never marked migrated.
 */

const AGENT = "workspaces/Personal/Ledger";
const FLAT = JSON.stringify([
  { id: "r1", name: "Old", prompt: "p", schedule: "0 9 * * *" },
]);

function legacy() {
  const fake = generationStore();
  fake.put(`${AGENT}/CLAUDE.md`, "# Ledger\n");
  fake.put(`${AGENT}/.houston/routines.json`, FLAT);
  return fake;
}

async function run(
  fake: ReturnType<typeof generationStore>,
  opts: { fenced?: boolean; fetchImpl?: typeof fetch } = {},
) {
  const seed = seedRequest({ name: "Ledger" });
  const request: OpRequest & { op: MigrateOp } = {
    ...seed,
    op: { kind: "migrate", version: AGENT_STORE_MIGRATION_VERSION },
  };
  const docs = docRoute();
  const reply = await executeMigrateOp({
    deps: opts.fetchImpl
      ? { ...docs.deps, fetchImpl: opts.fetchImpl }
      : docs.deps,
    op: request,
    turn: { ...request, conversationId: "agent-ops" },
    store: fake.store,
    prefix: PREFIX,
    root: mkdtempSync(join(tmpdir(), "op-migrate-root-")),
    fenced: async () => opts.fenced === true,
  });
  const relayed = reply.body as { status?: number; body?: string };
  return {
    reply,
    status: relayed.status,
    answer: relayed.body
      ? (JSON.parse(relayed.body) as Record<string, unknown>)
      : {},
  };
}

test("a family file another writer lands mid-migration stays theirs, and the run is not durable", async () => {
  const fake = legacy();
  const racer = '[{"id":"r2","name":"Racer","prompt":"p"}]';
  fake.hooks.beforeUpload = (key) => {
    if (key.endsWith(".houston/routines/routines.json"))
      fake.put(`${AGENT}/.houston/routines/routines.json`, racer);
  };

  const { status, answer } = await run(fake);

  expect(status).toBe(409);
  expect(answer.code).toBe("migration_not_durable");
  expect(fake.read(`${AGENT}/.houston/routines/routines.json`)).toBe(racer);
  expect(fake.read(`${AGENT}/.houston/routines.json`)).toBe(FLAT);
});

test("a custody store that refuses the secrets leaves the store untouched", async () => {
  const fake = legacy();
  fake.put("custom-integration-secrets.json", '{"ci_crm_KEY":"plain"}');
  const refusing = (async (url: unknown) =>
    String(url).includes("/custom-secrets/")
      ? new Response("down", { status: 503 })
      : Response.json(
          { error: "document not found" },
          { status: 404 },
        )) as typeof fetch;

  const { status, answer } = await run(fake, { fetchImpl: refusing });

  expect(status).toBe(500);
  expect(answer.code).toBe("migration_failed");
  expect(fake.uploads).toEqual([]);
  expect(fake.deletes).toEqual([]);
});

test("a fenced claim writes nothing", async () => {
  const fake = legacy();

  const { reply } = await run(fake, { fenced: true });

  expect(reply).toEqual({ status: 409, body: { error: "claim_fenced" } });
  expect(fake.uploads).toEqual([]);
});
