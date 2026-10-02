import type { TurnServerDeps } from "./server-types";
import type { ActivityDocPublishResult } from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishCustomDefinitionsView } from "./turn-custom-definitions-doc";
import { turnDocTarget } from "./turn-doc-target";
import type { TurnFilesystem } from "./turn-filesystem";
import type { TurnSandboxViews } from "./turn-sandbox";
import { publishLandedSkillsView } from "./turn-skills-view";
import type { TurnRequest } from "./types";

type TurnViewEvent = "CustomIntegrationsChanged" | "SkillsChanged";

async function publishCustomDefinitions(
  deps: TurnServerDeps,
  turn: TurnRequest,
  views: TurnSandboxViews | undefined,
  source: ActivityDocSource,
): Promise<ActivityDocPublishResult | null> {
  if (views?.customDefinitions === undefined) return null;
  const target = turnDocTarget(deps, turn, "custom_definitions");
  if (!target) return null;
  return publishCustomDefinitionsView(target, source, views.customDefinitions);
}

/** Why a doc publish did not land, or null when it did. A doc the store
 *  would not take (`disabled`) is as stale as one that failed. */
export const docNotLandedReason = (
  result: ActivityDocPublishResult,
): string | null =>
  "error" in result
    ? result.error
    : "disabled" in result
      ? result.reason
      : "skipped" in result
        ? result.skipped
        : null;

/**
 * Publish the views a claimed turn changed, so the gateway's asleep reads
 * show them: the custom-integration definitions its tools changed and the
 * skills list its SKILL.md writes changed (`landed` = the keys sync-back
 * uploaded or deleted). Answers the events whose view did not land: an event
 * promises the refetch can be served asleep, which a stale view breaks.
 */
export async function publishTurnViews(input: {
  deps: TurnServerDeps;
  turn: TurnRequest;
  filesystem: TurnFilesystem;
  views: TurnSandboxViews | undefined;
  source: ActivityDocSource;
  landed: readonly string[];
}): Promise<TurnViewEvent[]> {
  const outcomes: Array<
    [TurnViewEvent, string, ActivityDocPublishResult | null]
  > = [
    [
      "CustomIntegrationsChanged",
      "custom_definitions",
      await publishCustomDefinitions(
        input.deps,
        input.turn,
        input.views,
        input.source,
      ),
    ],
    ["SkillsChanged", "skills", await publishLandedSkillsView(input)],
  ];
  const stale: TurnViewEvent[] = [];
  for (const [event, family, result] of outcomes) {
    const reason = result && docNotLandedReason(result);
    if (!reason) continue;
    console.error(
      `[turn] ${family} view publish failed after durable sync: ${reason}`,
    );
    stale.push(event);
  }
  return stale;
}
