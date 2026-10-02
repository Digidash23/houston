import {
  type ConflictBackoff,
  jitteredConflictBackoff,
} from "@houston/runtime-client/object-sync";
import {
  type ActivityDocOptions,
  type ActivityDocPublishResult,
  acceptPut,
  putAtRevision,
  request,
  statusError,
} from "./turn-activity-doc";

/**
 * PUTs a merged doc gets before a still-contended doc is reported. Writers
 * racing in lockstep land one per round, so this bounds the overlap served
 * (ten runs of one agent finishing together), with jitter breaking lockstep.
 */
export const DOC_MERGE_ROUNDS = 10;

interface CurrentDoc {
  revision: number;
  doc?: unknown;
}

/** The revision and doc a pod-store answer carries (a GET, a 409). */
async function readAnswer(
  response: Response,
): Promise<{ revision?: number; doc?: unknown; carriesDoc: boolean }> {
  const etag = response.headers
    .get("ETag")
    ?.replace(/^W\//, "")
    .replaceAll('"', "");
  const tagged =
    etag && Number.isSafeInteger(Number(etag)) ? Number(etag) : undefined;
  let body: { revision?: unknown; doc?: unknown } = {};
  try {
    const parsed = JSON.parse(await response.text()) as unknown;
    if (typeof parsed === "object" && parsed !== null)
      body = parsed as typeof body;
  } catch {
    // No JSON body: only the ETag can name the revision.
  }
  const revision =
    tagged ??
    (typeof body.revision === "number" && Number.isSafeInteger(body.revision)
      ? body.revision
      : undefined);
  return { revision, doc: body.doc, carriesDoc: "doc" in body };
}

async function readCurrent(
  opts: ActivityDocOptions,
): Promise<CurrentDoc | { error: string }> {
  const response = await request(opts);
  if (response.status === 404) {
    await response.body?.cancel();
    return { revision: 0 };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return statusError("GET", response);
  }
  const answer = await readAnswer(response);
  // Merging into nothing would PUT this writer's rows alone over the doc.
  if (!answer.carriesDoc) return { error: "GET answered without a doc" };
  return { revision: answer.revision ?? 0, doc: answer.doc };
}

/**
 * PUT `merge(current)` over the doc the store holds, never a blind copy: a
 * slower writer that read a fresh revision would otherwise overwrite a newer
 * doc without ever seeing a 409. A lost race merges again into the doc the
 * 409 names (or a re-read when it names none), for DOC_MERGE_ROUNDS PUTs.
 */
export async function publishMerged(
  opts: ActivityDocOptions,
  merge: (current: unknown) => unknown,
  backoff: ConflictBackoff = jitteredConflictBackoff,
): Promise<ActivityDocPublishResult> {
  let current = await readCurrent(opts);
  for (let round = 1; ; round += 1) {
    if ("error" in current) return current;
    if (round > 1) await sleep(backoff(round - 1));
    const response = await putAtRevision(
      opts,
      merge(current.doc),
      current.revision,
    );
    if (response.status !== 409 || round === DOC_MERGE_ROUNDS) {
      return acceptPut(response);
    }
    const conflict = await readAnswer(response);
    current =
      conflict.revision !== undefined && conflict.carriesDoc
        ? { revision: conflict.revision, doc: conflict.doc }
        : await readCurrent(opts);
  }
}

/**
 * PUT a doc `derive` reads from the durable object, read only AFTER the
 * revision it lands at: any writer that landed its object before this read
 * is in the doc, and one that lands after it either PUTs later from its own
 * fresh read or meets this PUT's revision as a 409. A lost race re-derives at
 * the revision the 409 names, for DOC_MERGE_ROUNDS PUTs. For docs whose
 * entry order only the object knows (a merged learnings file), where a merge
 * of this writer's copy could only approximate it.
 */
export async function publishDerived(
  opts: ActivityDocOptions,
  derive: () => Promise<unknown>,
  backoff: ConflictBackoff = jitteredConflictBackoff,
): Promise<ActivityDocPublishResult> {
  let current = await readCurrent(opts);
  for (let round = 1; ; round += 1) {
    if ("error" in current) return current;
    if (round > 1) await sleep(backoff(round - 1));
    const response = await putAtRevision(
      opts,
      await derive(),
      current.revision,
    );
    if (response.status !== 409 || round === DOC_MERGE_ROUNDS) {
      return acceptPut(response);
    }
    const conflict = await readAnswer(response);
    current =
      conflict.revision !== undefined
        ? { revision: conflict.revision }
        : await readCurrent(opts);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
