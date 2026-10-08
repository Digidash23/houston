import { canUseAgent } from "../domain/access";
import type { FiringJob, RoutineFirer } from "./agent-scan";

/**
 * The routine's recorded creator can no longer use its agent, so it is not
 * fired as them. Permanent until someone who can use the agent saves the
 * routine again (every edit re-stamps `created_by` to the editor). The message
 * is the run row's summary, which the person reads verbatim.
 */
export class RoutineCreatorRefusedError extends Error {
  readonly code = "routine_creator_refused" as const;

  constructor(
    readonly routineId: string,
    /** Why the access check refused, for the log line only. */
    readonly reason: string,
  ) {
    super(
      "This routine was set up by someone who can no longer use this AI Employee. Open it and save it again to run it as you.",
    );
    this.name = "RoutineCreatorRefusedError";
  }
}

/**
 * Rechecks, at every fire, that the routine's `created_by` may still use the
 * agent: the host's own access rule (`canUseAgent`), the one every agent route
 * applies. Only where this host is the authority on access (desktop,
 * self-host); behind the gateway `created_by` is a gateway identity this host
 * cannot judge, and the gateway rechecks it before it delivers a fire.
 *
 * A routine with no `created_by` predates attribution and fires as before: it
 * names no one, so it acts as no one in particular.
 */
export class CreatorCheckedFirer implements RoutineFirer {
  constructor(private readonly inner: RoutineFirer) {}

  async fire(job: FiringJob): Promise<void> {
    const createdBy = job.routine.created_by;
    if (createdBy) {
      const access = canUseAgent({
        userId: createdBy,
        agent: job.agent,
        workspace: job.workspace,
      });
      if (!access.ok)
        throw new RoutineCreatorRefusedError(job.routine.id, access.reason);
    }
    await this.inner.fire(job);
  }
}
