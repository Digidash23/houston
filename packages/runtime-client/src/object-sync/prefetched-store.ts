import { writeAtomically } from "./http-store-batch";
import { type ObjectMetadata, parseObjectManifest } from "./object-manifest";
import { underObjectPrefix } from "./object-prefix";
import type {
  BatchReadEntry,
  BatchReadOutcome,
  ObjectStore,
  ReadOptions,
  ReadResult,
  WriteOptions,
  WriteResult,
} from "./object-store";

/** What the dispatcher shipped inside the turn: the listing plus the bytes of
 *  the objects it chose to inline. */
export interface PrefetchedObjects {
  manifest: ObjectMetadata[];
  objects: Map<string, { data: Buffer; generation?: string }>;
}

/** Parse the envelope's `prefetch`. Anything malformed is dropped rather
 *  than failing the turn: the store can always be read directly. */
export function parsePrefetchedObjects(
  value: unknown,
): PrefetchedObjects | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { manifest?: unknown; objects?: unknown };
  try {
    const manifest = parseObjectManifest(
      { objects: raw.manifest },
      "turn prefetch",
    );
    const objects = new Map<string, { data: Buffer; generation?: string }>();
    if (raw.objects && typeof raw.objects === "object") {
      for (const [key, entry] of Object.entries(raw.objects)) {
        const object = entry as { data?: unknown; generation?: unknown };
        if (typeof object.data !== "string") continue;
        objects.set(key, {
          data: Buffer.from(object.data, "base64"),
          ...(typeof object.generation === "string" && object.generation !== "0"
            ? { generation: object.generation }
            : {}),
        });
      }
    }
    return { manifest, objects };
  } catch {
    return undefined;
  }
}

/**
 * Serves hydration from the prefetched listing and bytes, and everything
 * else from the real store. The listing answers the FIRST manifest call only
 * (hydration's); each inlined object is served once and then forgotten, so
 * later reads and every write see the live store.
 */
export class PrefetchedObjectStore implements ObjectStore {
  private manifestServed = false;

  constructor(
    private readonly inner: ObjectStore,
    private readonly prefetched: PrefetchedObjects,
  ) {}

  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }

  async manifest(prefix = ""): Promise<ObjectMetadata[]> {
    if (!this.manifestServed) {
      this.manifestServed = true;
      return this.prefetched.manifest.filter((object) =>
        underObjectPrefix(object.key, prefix),
      );
    }
    if (this.inner.manifest) return this.inner.manifest(prefix);
    const keys = await this.inner.list(prefix);
    return keys.map((key) => ({ key, size: 0, md5: "", updated: "" }));
  }

  async download(key: string, destFile: string, opts?: ReadOptions) {
    await this.downloadVersioned(key, destFile, opts);
  }

  async downloadVersioned(
    key: string,
    destFile: string,
    opts?: ReadOptions,
  ): Promise<ReadResult> {
    const hit = this.take(key);
    if (hit) {
      await writeAtomically(destFile, hit.data);
      return hit.generation ? { generation: hit.generation } : {};
    }
    if (this.inner.downloadVersioned) {
      return this.inner.downloadVersioned(key, destFile, opts);
    }
    await this.inner.download(key, destFile, opts);
    return {};
  }

  async downloadMany(
    entries: BatchReadEntry[],
    opts?: ReadOptions,
  ): Promise<Map<string, BatchReadOutcome>> {
    const outcomes = new Map<string, BatchReadOutcome>();
    const misses: BatchReadEntry[] = [];
    for (const entry of entries) {
      const hit = this.take(entry.key);
      if (!hit) {
        misses.push(entry);
        continue;
      }
      await writeAtomically(entry.destFile, hit.data);
      outcomes.set(entry.key, {
        status: "ok",
        ...(hit.generation ? { generation: hit.generation } : {}),
      });
    }
    if (misses.length === 0) return outcomes;
    if (!this.inner.downloadMany) {
      for (const { key } of misses) outcomes.set(key, { status: "fallback" });
      return outcomes;
    }
    const rest = await this.inner.downloadMany(misses, opts);
    for (const [key, outcome] of rest) outcomes.set(key, outcome);
    return outcomes;
  }

  upload(
    srcFile: string,
    key: string,
    opts?: WriteOptions,
    // biome-ignore lint/suspicious/noConfusingVoidType: ObjectStore preserves void-returning adapters.
  ): Promise<WriteResult | void> {
    return this.inner.upload(srcFile, key, opts);
  }

  delete(key: string, opts?: WriteOptions): Promise<void> {
    return this.inner.delete(key, opts);
  }

  private take(key: string) {
    const hit = this.prefetched.objects.get(key);
    if (hit) this.prefetched.objects.delete(key);
    return hit;
  }
}
