// The session cache of the assistant's address, one entry per space. Kept
// dependency-light (query keys only) so `app/tests` can exercise it under
// node:test without the engine import chain.

import type { Query, QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys.ts";

const ROOT = String(queryKeys.assistant(null)[0]);

/**
 * Whether this cached query is an assistant address already in hand.
 *
 * The address is fixed for a person in a space: the gateway derives the agent
 * from who is asking, and the conversation id is a constant. Asking again is
 * not free either, since discovery holds the request until the assistant's
 * pod is awake. So a settled address outlives a space switch (the key names
 * its space, so no other space can read it) and the reconnect catch-up sweep
 * (no event is ever about it); only an identity change or the space leaving
 * the list drops it.
 *
 * An address still being asked for is NOT settled. Its retry ladder reads the
 * active space on every attempt, so after a switch it would ask the new space
 * and file the answer under the old key: it must be dropped with the rest.
 */
export function isSettledAssistantAddress(query: Query): boolean {
  return (
    query.queryKey[0] === ROOT &&
    query.queryKey.length === 2 &&
    query.state.status === "success" &&
    query.state.fetchStatus === "idle"
  );
}

/**
 * Forget the address of every space not in `listedSpaceIds`: the person left
 * that space (or it was deleted), so the next time it appears its assistant
 * is asked for again.
 */
export function forgetAssistantAddresses(
  queryClient: QueryClient,
  listedSpaceIds: readonly string[],
): void {
  const listed = new Set<unknown>(listedSpaceIds);
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === ROOT && !listed.has(query.queryKey[1]),
  });
}
