import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CustomIntegrationManager } from "@houston/host/src/integrations/custom/manager";
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

/** A writer's re-captured definitions list, the definitions that list was
 *  built from, and the slugs the writer changed. */
export interface CapturedCustomDefinitions {
  view: unknown;
  defs: readonly CustomIntegrationDef[];
  touched: ReadonlySet<string>;
}

/**
 * Capture the list the pod's route serves after this writer's mutations,
 * with the definitions file it was built from (the writer's local copy at
 * `storeRoot`): the view alone hides a definition's credential and source.
 */
export async function captureCustomDefinitions(
  manager: Pick<CustomIntegrationManager, "list">,
  storeRoot: string,
  touched: ReadonlySet<string>,
): Promise<CapturedCustomDefinitions> {
  let raw: string | null = null;
  try {
    raw = await readFile(join(storeRoot, customDefinitionsFile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const defs = storedDefinitions(raw);
  return { view: { items: await manager.list() }, defs, touched };
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

/** A standing entry shows exactly `def` as far as a view can tell. */
const showsDef = (def: CustomIntegrationDef, entry: CustomIntegrationView) =>
  isDeepStrictEqual(
    plain(viewOf(def, entry.state, entry.authMethods ?? [])),
    plain(entry),
  );

/**
 * One definition's entry: the store's def with the live state (compile
 * status, auth methods) of a capture of exactly that def when there is one,
 * so a capture of an older def never brings its state back. The writer's
 * own capture leads for the slugs it changed, the standing doc's otherwise.
 * Undefined when no capture holds the slug: its writer publishes it.
 */
function entryFor(
  def: CustomIntegrationDef,
  ours: { entry?: CustomIntegrationView; def?: CustomIntegrationDef },
  theirs: CustomIntegrationView | undefined,
  touched: boolean,
): CustomIntegrationView | undefined {
  const oursCurrent =
    ours.entry !== undefined &&
    ours.def !== undefined &&
    isDeepStrictEqual(plain(ours.def), plain(def));
  const theirsCurrent = theirs !== undefined && showsDef(def, theirs);
  const pick = touched
    ? oursCurrent
      ? ours.entry
      : theirsCurrent
        ? theirs
        : (ours.entry ?? theirs)
    : theirsCurrent
      ? theirs
      : oursCurrent
        ? ours.entry
        : (theirs ?? ours.entry);
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
  const mineDefs = new Map(captured.defs.map((def) => [def.slug, def]));
  const derive = async (current: unknown) => {
    const standing = entries(current);
    const defs = storedDefinitions(
      await readStoreText(source, customDefinitionsFile),
    );
    const items: CustomIntegrationView[] = [];
    for (const def of defs) {
      const entry = entryFor(
        def,
        { entry: mine.get(def.slug), def: mineDefs.get(def.slug) },
        standing.get(def.slug),
        captured.touched.has(def.slug),
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
