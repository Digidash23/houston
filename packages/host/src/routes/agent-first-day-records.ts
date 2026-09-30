import {
  loadActivities,
  missionConversationKey,
  removeById,
  saveActivities,
  upsertById,
  withDocLock,
} from "@houston/domain";
import type {
  Activity,
  AgentConfig,
  FirstDayStartResult,
} from "@houston/protocol";
import { recordFirstDayStarted } from "./agent-first-day-retire";
import type { FirstDayStartDeps } from "./agent-first-day-start";

/**
 * The writes a first-day start makes (`agent-first-day-start.ts`), each under
 * the SAME per-document lock every other writer of that document takes.
 */

type RecordDeps = Pick<FirstDayStartDeps, "vfs" | "root" | "agent" | "emit">;

const activityChanged = (deps: RecordDeps) =>
  deps.emit?.({ type: "ActivityChanged", agentPath: deps.agent.id });

/** Put the setup task on the board. */
export async function saveTask(deps: RecordDeps, task: Activity) {
  await withDocLock(`${deps.root}#activity`, async () => {
    const { items } = await loadActivities(deps.vfs, deps.root);
    await saveActivities(deps.vfs, deps.root, upsertById(items, task));
  });
  activityChanged(deps);
}

/** Take a task whose first turn never started off the board again. */
export async function dropTask(deps: RecordDeps, id: string) {
  await withDocLock(`${deps.root}#activity`, async () => {
    const { items } = await loadActivities(deps.vfs, deps.root);
    const result = removeById(items, id);
    if (result.removed) await saveActivities(deps.vfs, deps.root, result.items);
  });
  activityChanged(deps);
}

/** Record the setup task's first turn after it starts. */
export async function recordStarted(deps: RecordDeps): Promise<void> {
  await recordFirstDayStarted({
    vfs: deps.vfs,
    root: deps.root,
    agentId: deps.agent.id,
    emit: deps.emit,
  });
}

export function resultFor(
  outcome: FirstDayStartResult["outcome"],
  task: Activity,
  config: AgentConfig,
  role: string | null,
): FirstDayStartResult {
  return {
    outcome,
    mission: {
      id: task.id,
      sessionKey: missionConversationKey(task),
      title: task.title,
    },
    role,
    ...(config.arrival ? { arrival: config.arrival } : {}),
  };
}
