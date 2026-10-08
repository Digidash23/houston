import { downloadFile } from "./http-store-download";
import { objectStoreResponseError } from "./http-store-errors";
import { type ObjectMetadata, parseObjectManifest } from "./object-manifest";
import { underObjectPrefix } from "./object-prefix";
import type { ReadResult } from "./object-store";
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

export function downloadHttpObject(
  request: SignalledRequest,
  capture: CaptureResponse,
  key: string,
  destFile: string,
  signal?: AbortSignal,
): Promise<ReadResult> {
  return withOperationSignal(signal, async (own) => {
    const response = await request(own);
    capture(response);
    if (!response.ok) {
      throw await objectStoreResponseError(response, "GET", key);
    }
    return downloadFile(response, key, destFile, own);
  });
}
