import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { landStream } from "./land-file";
import type { ReadResult } from "./object-store";

/** Atomically land one successful object GET and retain its generation. */
export async function downloadFile(
  response: Response,
  key: string,
  destFile: string,
  signal?: AbortSignal,
): Promise<ReadResult> {
  if (!response.body) {
    throw new Error(`object store GET ${key} returned no response body`);
  }
  const body = response.body;
  const open = () => Readable.fromWeb(body as NodeReadableStream);
  if (!(await landStream(open, destFile, signal))) {
    // Refused: release the connection instead of leaving the body unread.
    await body.cancel();
    return { refused: true };
  }
  const generation = response.headers.get("X-Houston-Generation");
  return generation && generation !== "0" ? { generation } : {};
}
