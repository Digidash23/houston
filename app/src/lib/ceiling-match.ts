/**
 * The allowed-models ceiling rule (Teams E8), as the gateway enforces it
 * (cloud `internal/edge/agents/ceiling.go`): the composer offers, pins and
 * writes exactly what the gateway's clamp and model-choice route accept.
 *
 * A ceiling (`null`/`undefined` = every model, `[]` = none) allows `provider`
 * running `model` when `model` is a ceiling entry (case-insensitive, any
 * provider), or when `provider`'s OWN catalog row for some entry runs as
 * `model` (`runsAs`, see `./providers/runs-as.ts`). A ceiling written with
 * `claude-opus-5` therefore admits `claude-opus-5-5` on anthropic, which runs
 * the retired id as that lineup model, and on no other provider.
 */

import { decodeModelPickerId } from "./chat-model-picker-ids.ts";

/** The model `provider`'s own catalog row for `model` runs as, or `null`. */
export type RunsAsLookup = (provider: string, model: string) => string | null;

/** Whether the ceiling allows `model` on `provider`. */
export function isModelAllowed(
  allowedModels: readonly string[] | null | undefined,
  provider: string,
  model: string,
  runsAs: RunsAsLookup,
): boolean {
  if (allowedModels == null) return true;
  const target = model.toLowerCase();
  return allowedModels.some(
    (entry) =>
      entry.toLowerCase() === target ||
      (provider !== "" && runsAs(provider, entry)?.toLowerCase() === target),
  );
}

/**
 * The model `provider` runs for one ceiling entry: the entry's `runsAs` when
 * the provider's row carries one, else the entry itself when `offers` says the
 * provider lists it, else `null`.
 */
export function runnableEntry(
  provider: string,
  entry: string,
  offers: (provider: string, model: string) => boolean,
  runsAs: RunsAsLookup,
): string | null {
  return runsAs(provider, entry) ?? (offers(provider, entry) ? entry : null);
}

/** One picker row: an opaque `provider::model` id plus its provider. */
interface PickerRow {
  id: string;
  providerId: string;
}

/**
 * The picker clamped to the ceiling: the rows it allows, and the providers
 * left with at least one of them (a provider with none drops out of the rail).
 * No ceiling returns both lists untouched.
 */
export function clampPickerToCeiling<
  M extends PickerRow,
  P extends { id: string },
>(
  models: M[],
  providers: P[],
  allowedModels: readonly string[] | null | undefined,
  runsAs: RunsAsLookup,
): { models: M[]; providers: P[] } {
  if (allowedModels == null) return { models, providers };
  const kept = models.filter((row) => {
    const { provider, model } = decodeModelPickerId(row.id);
    return isModelAllowed(allowedModels, provider, model, runsAs);
  });
  const ids = new Set(kept.map((row) => row.providerId));
  return { models: kept, providers: providers.filter((p) => ids.has(p.id)) };
}

/**
 * How many DISTINCT models the ceiling removes from the picker's universe.
 * Display-only: the gateway is the sole enforcer, so this count only keeps the
 * clamp honest, surfacing the models it drops instead of hiding them in
 * silence.
 *
 * Counted over bare model ids: a model counts as hidden only when NONE of its
 * rows survives, so a model offered by two providers is one hidden model, and a
 * model the ceiling keeps on one provider is not hidden at all.
 */
export function hiddenModelCount(
  pickerModels: ReadonlyArray<{ id: string }>,
  allowedModels: readonly string[] | null,
  runsAs: RunsAsLookup,
): number {
  if (allowedModels == null) return 0;
  const kept = new Set<string>();
  const all = new Set<string>();
  for (const row of pickerModels) {
    const { provider, model } = decodeModelPickerId(row.id);
    all.add(model);
    if (isModelAllowed(allowedModels, provider, model, runsAs)) kept.add(model);
  }
  return [...all].filter((model) => !kept.has(model)).length;
}
