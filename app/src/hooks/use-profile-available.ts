import { isIdentityConfigured } from "../lib/identity";
import { useMyEditableProfile } from "./queries/use-my-editable-profile";
import { useSession } from "./use-session";

/**
 * Whether the account menu offers Profile at all. Gated by DATA, never by a
 * flag: the item appears only once the profile READ succeeded, so a host that
 * 404s the route (`data === null`) or a read that failed hides an editor that
 * could not save anyway.
 */
export function useProfileAvailable(): boolean {
  const { data: session } = useSession();
  const { data } = useMyEditableProfile();
  return isIdentityConfigured() && !!session && data != null;
}
