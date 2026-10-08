import { loadRoutineRuns } from "@houston/domain";
import type { Routine } from "@houston/protocol";
import { expect, test } from "vitest";
import type { Agent, Workspace } from "../domain/types";
import { CloudPaths } from "../paths";
import { MemoryVfs } from "../vfs";
import {
  CreatorCheckedFirer,
  RoutineCreatorRefusedError,
} from "./creator-access";
import { fireRoutineRun } from "./run";
import type { FiringJob, RoutineFirer } from "./scheduler";

/**
 * Off the gateway (desktop, self-host) this host is the authority on who may
 * use an agent, so it rechecks at fire time that the routine's `created_by`
 * still can. A routine only ever runs as someone who can use its agent.
 */

const ws: Workspace = {
  id: "w1",
  ownerUserId: "local-owner",
  kind: "personal",
  name: "W",
  slug: "w1",
  runtime: "local",
  createdAt: 0,
};
const agent: Agent = { id: "a1", workspaceId: "w1", name: "A", createdAt: 0 };
const paths = new CloudPaths();

const routine = (createdBy?: string): Routine => ({
  id: "r1",
  name: "Daily report",
  prompt: "Write the daily report",
  schedule: "0 9 * * *",
  enabled: true,
  suppress_when_silent: false,
  chat_mode: "shared",
  integrations: [],
  created_at: "",
  updated_at: "",
  ...(createdBy ? { created_by: createdBy } : {}),
});

function recordingFirer(): RoutineFirer & { fired: FiringJob[] } {
  const fired: FiringJob[] = [];
  return {
    fired,
    async fire(job) {
      fired.push(job);
    },
  };
}

const fire = (vfs: MemoryVfs, firer: RoutineFirer, r: Routine) =>
  fireRoutineRun(
    { vfs, paths, firer, now: () => new Date(0), newId: () => "run-1" },
    ws,
    agent,
    r,
  );

test("the owner's routine fires", async () => {
  const inner = recordingFirer();
  await fire(
    new MemoryVfs(),
    new CreatorCheckedFirer(inner),
    routine("local-owner"),
  );
  expect(inner.fired).toHaveLength(1);
});

test("a routine with no recorded creator still fires (it acts as no one in particular)", async () => {
  const inner = recordingFirer();
  await fire(new MemoryVfs(), new CreatorCheckedFirer(inner), routine());
  expect(inner.fired).toHaveLength(1);
});

test("a routine whose creator cannot use the agent is refused and its run recorded as failed", async () => {
  const vfs = new MemoryVfs();
  const inner = recordingFirer();
  await expect(
    fire(vfs, new CreatorCheckedFirer(inner), routine("someone-else")),
  ).rejects.toBeInstanceOf(RoutineCreatorRefusedError);
  expect(inner.fired).toEqual([]);
  const { items } = await loadRoutineRuns(vfs, paths.agentRoot(ws, agent));
  expect(items).toHaveLength(1);
  expect(items[0]?.status).toBe("error");
  expect(items[0]?.summary).toContain("save it again");
});
