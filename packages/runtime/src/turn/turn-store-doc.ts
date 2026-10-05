import type {
  ActivityDocOptions,
  ActivityDocPublishResult,
} from "./turn-activity-doc";
import type { ActivityDocSource } from "./turn-activity-source";
import { publishDerived } from "./turn-doc-merge-publish";
import { readStoreText } from "./turn-store-read";

/**
 * Publish the doc `project` makes of one store object (`rel`; null when it is
 * gone), read only after the doc revision it lands at (publishDerived). Never
 * the writer's own copy: a writer that landed the object after this writer's
 * upload is in the store, and its doc may already be published, so projecting
 * the older local copy would roll that writer's change back.
 */
export async function publishStoreDoc(
  target: ActivityDocOptions,
  source: ActivityDocSource,
  rel: string,
  project: (raw: string | null) => unknown,
): Promise<ActivityDocPublishResult> {
  try {
    return await publishDerived(target, async () =>
      project(await readStoreText(source, rel)),
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
