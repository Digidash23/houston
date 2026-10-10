import type {
  EditableProfile,
  EditableProfileUpdate,
} from "@houston/engine-adapter";
import {
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { patchEditableProfile } from "../../lib/editable-profile-patch";
import { isIdentityConfigured } from "../../lib/identity";
import type { OptimisticFailureCopy } from "../../lib/optimistic-core";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { tauriProfile } from "../../lib/tauri";
import { useUIStore } from "../../stores/ui";
import { useSession } from "../use-session";
import { ORG_PEOPLE_KEY } from "./use-org-people";
import { USER_PROFILES_KEY } from "./use-user-profiles";

/** Query key for the signed-in user's own editable display profile. */
export const MY_EDITABLE_PROFILE_KEY = "my-editable-profile";

/**
 * The signed-in user's OWN display profile (name + photo) from the gateway's
 * `GET /v1/me/profile`: the EFFECTIVE values, plus `custom` telling the form
 * which of them the user set by hand rather than inheriting from Google (that
 * flag is what makes "Remove picture" meaningful).
 *
 * Deliberately NOT multiplayer-gated, unlike `useOrgPeople` — naming
 * yourself is not a team feature; every signed-in user gets it. It only needs a
 * configured identity backend and a live session. Off-gateway, or on a gateway
 * predating the route (which 404s), the read degrades to `null` and the caller
 * hides the Profile screen rather than offering an editor that cannot save.
 * A failure never toasts and is never captured (see `tauriProfile.get`): it is
 * indistinguishable from "this host has no such feature" by design.
 *
 * Cached generously — a profile changes when the user changes it, and that path
 * writes the fresh value straight into this cache ({@link useSetMyProfile}).
 */
export function useMyEditableProfile(): UseQueryResult<EditableProfile | null> {
  const { data: session } = useSession();

  return useQuery({
    queryKey: [MY_EDITABLE_PROFILE_KEY],
    queryFn: () => tauriProfile.get(),
    enabled: isIdentityConfigured() && !!session,
    staleTime: 5 * 60_000,
  });
}

/** What a profile save tells the person: on refusal, and once it landed. */
export interface ProfileSaveCopy {
  failure: OptimisticFailureCopy;
  saved: string;
}

/**
 * Save the user's own name and/or photo. Per key: a string sets, `null` clears
 * back to the Google value, an omitted key leaves that field untouched — so an
 * editor that only changed the name must send only `displayName`.
 *
 * Optimistic: the Profile screen shows the new name or picture at once
 * (`patchEditableProfile`) and the save runs behind it. A refusal (the host's
 * 400 for a too-long name or an oversized picture included) rolls the screen
 * back and tells the person with `copy.failure`. Once the host answers, its
 * profile replaces the guess, and every OTHER cache that paints a face or a
 * name refreshes so the change lands everywhere:
 * - `USER_PROFILES_KEY` by prefix — the caller's own self-face plus every
 *   teammate face stack (each is `[USER_PROFILES_KEY, ...ids]`);
 * - `ORG_PEOPLE_KEY` — the @mention roster the composer and renderer read;
 * - `queryKeys.org()` — the People roster behind the Permissions/Admin views.
 *
 * The returned save never rejects.
 */
export function useSetMyProfile(): (
  update: EditableProfileUpdate,
  copy: ProfileSaveCopy,
) => Promise<void> {
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  return useCallback(
    (update, copy) =>
      optimisticWrite({
        qc,
        command: "set_my_profile",
        patches: [
          {
            queryKey: [MY_EDITABLE_PROFILE_KEY],
            apply: (profile: EditableProfile | null | undefined) =>
              patchEditableProfile(profile, update),
          },
        ],
        write: () => tauriProfile.set(update),
        failure: copy.failure,
        invalidate: [
          [MY_EDITABLE_PROFILE_KEY],
          [USER_PROFILES_KEY],
          [ORG_PEOPLE_KEY],
          queryKeys.org(),
        ],
        onSuccess: (data) => {
          qc.setQueryData([MY_EDITABLE_PROFILE_KEY], data);
          addToast({ title: copy.saved });
        },
      }),
    [qc, addToast],
  );
}
