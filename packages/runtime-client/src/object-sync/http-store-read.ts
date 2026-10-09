import { downloadFile } from "./http-store-download";
import { objectStoreResponseError } from "./http-store-errors";
import { type ObjectMetadata, parseObjectManifest } from "./object-manifest";
import { underObjectPrefix } from "./object-prefix";
import type { ReadOptions, ReadResult } from "./object-store";
import { withOperationSignal } from "./operation-signal";

type CaptureResponse = (response: Response) => void;
type SignalledRequest = (signal?: AbortSignal) => Promise<Response>;

export function readHttpManifest(
  request: SignalledRequest,
  capture: CaptureResponse,
  prefix: string,
  signal?: AbortSignal,
): Promise<ObjectMetadata[]> {
  return withOperationSignal(signal, async (own) => {
    const response = await request(own);
    capture(response);
    if (!response.ok) {
      throw await objectStoreResponseError(response, "GET", "manifest");
    }
    return parseObjectManifest(
      await response.json(),
      "object store GET manifest",
    ).filter((object) => underObjectPrefix(object.key, prefix));
  });
}

/** A GET given its signal and the not-modified condition headers, if any. */
type ConditionalRequest = (
  signal: AbortSignal | undefined,
  condition: Record<string, string>,
) => Promise<Response>;

export function downloadHttpObject(
  request: ConditionalRequest,
  capture: CaptureResponse,
  key: string,
  destFile: string,
  opts?: ReadOptions,
): Promise<ReadResult> {
  return withOperationSignal(opts?.signal, async (own) => {
    const held = opts?.ifGenerationNotMatch;
    const response = await request(
      own,
      held ? { "X-Houston-If-Generation-Not-Match": held } : {},
    );
    capture(response);
    if (response.status === 304 && held)
      return { generation: held, notModified: true };
    if (!response.ok) {
      throw await objectStoreResponseError(response, "GET", key);
    }
    return downloadFile(response, key, destFile, own);
  });
}
