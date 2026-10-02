import { isDeepStrictEqual } from "node:util";
import type {
  CustomIntegrationDef,
  CustomIntegrationView,
} from "@houston/host/src/integrations/custom/types";
import { viewOf } from "@houston/host/src/integrations/custom/views";
import type {
  ActivityDocOptions,
  ActivityDocPublishResult,
} from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { customDefinitionsFile } from "./turn-custom-context";
import { publishDerived } from "./turn-doc-merge-publish";
import { readStoreText } from "./turn-store-read";

/** A writer's re-captured definitions list and the slugs it changed. */
export interface CapturedCustomDefinitions {
  view: unknown;
  touched: ReadonlySet<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is CustomIntegrationView =>
  isRecord(value) &&
  typeof value.slug === "string" &&
  isRecord(value.state) &&
  Array.isArray(value.authMethods);

function entries(view: unknown): Map<string, CustomIntegrationView> {
  const items = isRecord(view) && Array.isArray(view.items) ? view.items : [];
  return new Map(items.filter(isEntry).map((entry) => [entry.slug, entry]));
}

function storedDefinitions(raw: string | null): CustomIntegrationDef[] {
  if (raw === null) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error(`${customDefinitionsFile}: unrecognized definitions shape`);
  }
  return parsed.items as CustomIntegrationDef[];
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

/**
 * One definition's entry: the store's def with the live state (compile
 * status, auth methods) of an entry captured from exactly that def when one
 * is, so a capture of an older def never brings its state back. The writer's
 * own capture leads for the slugs it changed, the standing doc's otherwise.
 * Undefined when no capture holds the slug: its writer publishes it.
 */
function entryFor(
  def: CustomIntegrationDef,
  candidates: Array<CustomIntegrationView | undefined>,
): CustomIntegrationView | undefined {
  const held = candidates.filter((entry) => entry !== undefined);
  const current = held.find((entry) =>
    isDeepStrictEqual(
      plain(viewOf(def, entry.state, entry.authMethods ?? [])),
      plain(entry),
    ),
  );
  const pick = current ?? held[0];
  return pick && viewOf(def, pick.state, pick.authMethods ?? []);
}

/**
 * Publish the custom-integration definitions view, merged per slug against
 * what the STORE holds once the doc revision is read (publishDerived): the
 * definitions file names which integrations exist and their details, so one
 * another writer added stays, one it removed stays gone, and a detail it
 * changed is never put back. Never the writer's captured list alone, which
 * is a snapshot from its own tree.
 */
export async function publishCustomDefinitionsView(
  target: ActivityDocOptions,
  source: ActivityDocSource,
  captured: CapturedCustomDefinitions,
): Promise<ActivityDocPublishResult> {
  const mine = entries(captured.view);
  const derive = async (current: unknown) => {
    const standing = entries(current);
    const defs = storedDefinitions(
      await readStoreText(source, customDefinitionsFile),
    );
    const items: CustomIntegrationView[] = [];
    for (const def of defs) {
      const ours = mine.get(def.slug);
      const theirs = standing.get(def.slug);
      const entry = entryFor(
        def,
        captured.touched.has(def.slug) ? [ours, theirs] : [theirs, ours],
      );
      if (entry) items.push(entry);
    }
    return { items };
  };
  try {
    return await publishDerived(target, derive);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
