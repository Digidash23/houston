import type {
  CustomIntegrationView,
  IntegrationConnection,
} from "@houston/wire-types";
import { mapItem, withoutItems } from "./list-patch.ts";
import type { OptimisticPatch } from "./optimistic-core.ts";
import { queryKeys } from "./query-keys.ts";

/**
 * Optimistic edits of the integration caches. Custom lists are `null` when the
 * host does not serve custom integrations; that stays `null`.
 */

type CustomList = CustomIntegrationView[] | null | undefined;

/** A disconnect: one account of the app, or every account when unnamed. */
export function connectionsWithout(
  connections: IntegrationConnection[] | undefined,
  toolkit: string,
  connectionId?: string,
): IntegrationConnection[] | undefined {
  return withoutItems(
    connections,
    (c) =>
      c.toolkit === toolkit &&
      (connectionId === undefined || c.connectionId === connectionId),
  );
}

export function customWithout(list: CustomList, slug: string): CustomList {
  return withoutItems(list, (i) => i.slug === slug);
}

/** The edit form's name + website; an empty website clears it, as the host does. */
export function customWithDetails(
  list: CustomList,
  slug: string,
  details: { name: string; website: string },
): CustomList {
  return mapItem(
    list,
    (i) => i.slug === slug,
    (i) => {
      const website = details.website || undefined;
      if (i.name === details.name && i.website === website) return i;
      const { website: _old, ...rest } = i;
      return website === undefined
        ? { ...rest, name: details.name }
        : { ...rest, name: details.name, website };
    },
  );
}

/** Every cache a custom integration shows in: the top-level and per-agent
 *  lists (one key prefix) and the merged connections view (slug = toolkit). */
export function customRemovalPatches(slug: string): OptimisticPatch[] {
  return [
    {
      queryKey: queryKeys.customIntegrations(),
      apply: (list: CustomList) => customWithout(list, slug),
    },
    {
      queryKey: queryKeys.integrationConnections("custom"),
      apply: (rows: IntegrationConnection[] | undefined) =>
        connectionsWithout(rows, slug),
    },
  ];
}

export function customEditPatches(
  slug: string,
  details: { name: string; website: string },
): OptimisticPatch[] {
  return [
    {
      queryKey: queryKeys.customIntegrations(),
      apply: (list: CustomList) => customWithDetails(list, slug, details),
    },
  ];
}
