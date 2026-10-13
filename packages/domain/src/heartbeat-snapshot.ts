import {
  type Activity,
  type InteractionStep,
  isSuggestionStep,
  type Routine,
  type RoutineRun,
} from "@houston/protocol";
import {
  type HeartbeatSection,
  type Keyed,
  orderSection,
} from "./heartbeat-sections";

/**
 * The deterministic look across the person's agents that runs BEFORE any model
 * call. An empty snapshot means the briefing records "quiet" and costs
 * nothing; a non-empty one is the material the prompt hands the manager.
 * Pure: the host loads each agent's board, routines and runs, this decides.
 */

/** One agent's documents, as the host loaded them. */
export interface HeartbeatAgentData {
  agentName: string;
  activities: readonly Activity[];
  routines: readonly Routine[];
  runs: readonly RoutineRun[];
}

export interface HeartbeatNeedsYou {
  agent: string;
  title: string;
  /** What the mission waits on (a question, a sign-in...), when it says. */
  waitingOn?: InteractionStep["kind"];
}

export interface HeartbeatRoutineRun {
  agent: string;
  routine: string;
  status: "error" | "surfaced";
  summary?: string;
  at: string;
}

export interface HeartbeatPausedRoutine {
  agent: string;
  routine: string;
  failures: number;
}

export interface HeartbeatDone {
  agent: string;
  title: string;
}

export interface HeartbeatSnapshot {
  needsYou: HeartbeatSection<HeartbeatNeedsYou>;
  routineRuns: HeartbeatSection<HeartbeatRoutineRun>;
  pausedRoutines: HeartbeatSection<HeartbeatPausedRoutine>;
  done: HeartbeatSection<HeartbeatDone>;
  /** Items not yet in the seen set, across sections, cut ones included. */
  unseen: number;
  /** Keys of the items this snapshot's briefing names. */
  namedKeys: string[];
  /** Keys of every matched item. */
  presentKeys: string[];
}

/** The first step the mission is genuinely blocked on (offers never block). */
function blockingKind(activity: Activity): InteractionStep["kind"] | undefined {
  return activity.pending_interaction?.steps.find(
    (step) => !isSuggestionStep(step),
  )?.kind;
}

const atOrAfter = (iso: string | undefined, sinceMs: number) =>
  iso !== undefined && Date.parse(iso) >= sinceMs;

/**
 * Everything worth a morning sentence: missions waiting on the person, routine
 * runs since `sinceMs` that failed or reported something, routines the engine
 * paused by itself, and missions finished since `sinceMs`. A surfaced run
 * whose card is already waiting on the person is named once, as the card.
 * Each item carries its identity key (heartbeat-news.ts); `seen` decides the
 * order each section is capped in.
 */
export function buildHeartbeatSnapshot(
  agents: readonly HeartbeatAgentData[],
  sinceMs: number,
  seen: ReadonlySet<string> = new Set(),
): HeartbeatSnapshot {
  const needsYou: (HeartbeatNeedsYou & Keyed)[] = [];
  const runs: (HeartbeatRoutineRun & Keyed)[] = [];
  const paused: (HeartbeatPausedRoutine & Keyed)[] = [];
  const done: (HeartbeatDone & Keyed)[] = [];
  for (const data of agents) {
    const agent = data.agentName;
    const waiting = new Set<string>();
    for (const activity of data.activities) {
      const at = activity.updated_at ?? "";
      const id = `${agent}/${activity.id}`;
      if (activity.status === "needs_you") {
        waiting.add(activity.id);
        const waitingOn = blockingKind(activity);
        needsYou.push({
          agent,
          title: activity.title,
          ...(waitingOn ? { waitingOn } : {}),
          key: `need:${id}`,
          at,
        });
      } else if (activity.status === "done" && atOrAfter(at, sinceMs)) {
        done.push({ agent, title: activity.title, key: `done:${id}`, at });
      }
    }
    const routineName = new Map(data.routines.map((r) => [r.id, r.name]));
    for (const run of data.runs) {
      if (run.status !== "error" && run.status !== "surfaced") continue;
      const at = run.completed_at ?? run.started_at;
      if (!atOrAfter(at, sinceMs)) continue;
      if (run.activity_id && waiting.has(run.activity_id)) continue;
      runs.push({
        agent,
        routine: routineName.get(run.routine_id) ?? run.routine_id,
        status: run.status,
        ...(run.summary ? { summary: run.summary } : {}),
        key: `run:${agent}/${run.id}`,
        at,
      });
    }
    for (const routine of data.routines) {
      if (routine.enabled || !routine.auto_paused) continue;
      const at = routine.auto_paused.at;
      paused.push({
        agent,
        routine: routine.name,
        failures: routine.auto_paused.failures,
        key: `pause:${agent}/${routine.id}:${at}`,
        at,
      });
    }
  }
  const ordered = {
    needsYou: orderSection(needsYou, seen),
    routineRuns: orderSection(runs, seen),
    pausedRoutines: orderSection(paused, seen),
    done: orderSection(done, seen),
  };
  const all = Object.values(ordered);
  const bare = <T extends Keyed>(
    section: HeartbeatSection<T>,
  ): HeartbeatSection<Omit<T, keyof Keyed>> => ({
    items: section.items.map(({ key: _key, at: _at, ...rest }) => rest),
    more: section.more,
  });
  return {
    needsYou: bare(ordered.needsYou.section),
    routineRuns: {
      items: ordered.routineRuns.section.items.map(
        ({ key: _key, ...run }) => run,
      ),
      more: ordered.routineRuns.section.more,
    },
    pausedRoutines: bare(ordered.pausedRoutines.section),
    done: bare(ordered.done.section),
    unseen: all.reduce((n, s) => n + s.unseen, 0),
    namedKeys: all.flatMap((s) => s.named),
    presentKeys: all.flatMap((s) => s.present),
  };
}

/** Nothing in any section: no model call, no message, no notification. */
export function isHeartbeatSnapshotEmpty(snapshot: HeartbeatSnapshot): boolean {
  return (
    snapshot.needsYou.items.length === 0 &&
    snapshot.routineRuns.items.length === 0 &&
    snapshot.pausedRoutines.items.length === 0 &&
    snapshot.done.items.length === 0
  );
}
