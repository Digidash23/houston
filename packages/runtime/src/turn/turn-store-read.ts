import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { decodeText } from "@houston/host/src/vfs";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";

/**
 * One object's text as the store holds it NOW, decoded the way the host's
 * vfs reads a file (BOM stripped), or null when it is gone. Downloads into a
 * scratch dir outside the synced tree: a store adapter creates the parent
 * directories of its destination, which would otherwise re-create a folder
 * the turn deleted.
 */
export async function readStoreText(
  source: { store: ObjectStore; prefix: string },
  rel: string,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "houston-store-read-"));
  try {
    const file = join(dir, "object");
    await source.store.download(
      source.prefix ? posix.join(source.prefix, rel) : rel,
      file,
    );
    return decodeText(await readFile(file));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
