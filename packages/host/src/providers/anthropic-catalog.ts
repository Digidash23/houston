import {
  ANTHROPIC_LINEUP,
  anthropicLineupModel,
} from "@houston/domain/model-aliases";
import type { CatalogProvider } from "@houston/protocol";

/**
 * The `anthropic` provider runs one model per Claude family
 * (`ANTHROPIC_LINEUP`), and the runtime runs every other Claude id on its own
 * family's lineup model (`lineupModelId`). The catalog says so explicitly: a
 * retired row stays listed, carrying `runsAs` = the lineup model a turn on it
 * runs, so an allowed-models ceiling written with that id keeps admitting the
 * model it runs as — the gateway's clamp and the app both read the field, on
 * this provider only.
 *
 * A row with no family in the lineup (Haiku) is dropped: nothing runs it, and
 * listing it would let a ceiling or picker offer a model no turn can run here.
 * Every other provider's Claude rows are that provider's own and untouched.
 */

export const ANTHROPIC_PROVIDER_ID = "anthropic";

const LINEUP_IDS: ReadonlySet<string> = new Set(
  Object.values(ANTHROPIC_LINEUP),
);

/** Pure: mark anthropic's retired rows with `runsAs`, drop familyless ones. */
export function withAnthropicLineup(
  provider: CatalogProvider,
): CatalogProvider {
  const models = provider.models.flatMap((entry) => {
    if (LINEUP_IDS.has(entry.id)) return [entry];
    const runsAs = anthropicLineupModel(entry.id);
    return runsAs === undefined ? [] : [{ ...entry, runsAs }];
  });
  return { ...provider, models };
}
