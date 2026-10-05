import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { decodeText } from "@houston/host/src/vfs";
import {
  ObjectNotFoundError,
  type ObjectStore,
} from "@houston/runtime-client/object-sync";

/** How long a doc's read-back from the store may take, retries included.
 *  The turn's terminal frame waits on its doc publishes. */
export const STORE_READ_TIMEOUT_MS = 15_000;

/**
 * One object's text as the store holds it NOW, decoded the way the host's
 * vfs reads a file (BOM stripped), or null when it is gone. Downloads into a
 * scratch dir outside the synced tree: a store adapter creates the parent
 * directories of its destination, which would otherwise re-create a folder
 * the turn deleted. A read that outlasts `timeoutMs` throws.
 */
export async function readStoreText(
  source: { store: ObjectStore; prefix: string },
  rel: string,
  timeoutMs = STORE_READ_TIMEOUT_MS,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "houston-store-read-"));
  try {
    const file = join(dir, "object");
    await source.store.download(
      source.prefix ? posix.join(source.prefix, rel) : rel,
      file,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return decodeText(await readFile(file));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
