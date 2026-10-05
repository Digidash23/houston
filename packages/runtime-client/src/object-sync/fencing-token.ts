/**
 * Take the fencing token a 2xx response published, but never a lower one than
 * this boot already carries. Tokens only grow (every mint is the row's token
 * plus one), while a pod-store replica publishes whatever its lease cache
 * holds, up to two seconds old: a hydrate read served by such a replica right
 * after this boot's own mint would otherwise put the predecessor's token back,
 * and the boot's next write would fence the boot itself.
 */
export function captureFencingToken(
  fence: { token?: string },
  published: string | null,
): void {
  if (published === null || published === "") return;
  const next = Number(published);
  if (!Number.isSafeInteger(next)) return;
  const current = fence.token === undefined ? undefined : Number(fence.token);
  if (
    current === undefined ||
    !Number.isSafeInteger(current) ||
    next > current
  ) {
    fence.token = published;
  }
}
