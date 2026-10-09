import type { OrgSummary, OrgsList } from "@houston/engine-adapter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { analytics } from "../../lib/analytics";
import { showExpectedStateToast } from "../../lib/error-toast";
import {
  classifyInviteError,
  type InviteFailure,
  isExpectedInviteError,
  teamIsInSwitcher,
} from "../../lib/invite-model";
import { runOptimisticWrite } from "../../lib/optimistic-core";
import { tellOptimisticRefusal } from "../../lib/optimistic-write";
import { orgsWithoutInvite } from "../../lib/org-cache-patches";
import { queryKeys } from "../../lib/query-keys";
import { tauriOrg } from "../../lib/tauri";
import { useUIStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspaces";

/**
 * The INVITEE side of C8 team invites: accept / decline a pending invite from
 * `GET /v1/orgs`'s `invites`. The owner's revoke is a different route and a
 * different hook (`useDeleteInvite`, `use-org.ts`).
 *
 * Both hooks refresh the spaces list on BOTH paths, not just on success:
 * every expected rejection (`already_member`, `invite_not_found`) means the
 * server's truth already moved on, so the stale card must disappear either way.
 * Declining is optimistic (the card leaves on the click); accepting waits for
 * the host, whose answer names the team it joined, but its invalidation fires
 * FIRST and is never awaited behind the workspace reload.
 *
 * Accepting also reloads the workspace store — a joined team reaches the
 * switcher through `GET /v1/workspaces`, which is Zustand, not a query the
 * invalidation could reach. That reload SWALLOWS its own failure (it only
 * records `loadError`), so the success toast checks `teamIsInSwitcher` against
 * the reloaded list before promising the team is there; when it isn't, the copy
 * says so instead. Nothing switches the active space: joining is not the same
 * as going there.
 *
 * Expected gateway states are silenced from `call()`'s red bug toast and get
 * ONE plain informational toast here instead (`invite-model.ts` holds the
 * taxonomy). Anything else keeps the standard toast + Sentry report.
 */

/** Copy for each expected rejection, keyed by `teams:inviteInbox.errors.*`. */
const FAILURE_COPY = {
  needs_upgrade: "needsUpgrade",
  already_member: "alreadyMember",
  invite_not_found: "gone",
} as const satisfies Record<Exclude<InviteFailure, "unknown">, string>;

export function useAcceptInvite() {
  const { t } = useTranslation("teams");
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  return useMutation<OrgSummary, unknown, string>({
    mutationFn: (inviteId: string) =>
      tauriOrg.acceptInvite(inviteId, { silence: isExpectedInviteError }),
    onSuccess: async (org) => {
      analytics.track("org_invite_accepted");
      // Prompt, un-awaited: the answered card must leave the sidebar now, not
      // after the workspace reload below.
      qc.invalidateQueries({ queryKey: queryKeys.orgs() });
      await loadWorkspaces();
      // `loadWorkspaces` resolves even when it failed, so the list itself is
      // the only honest evidence that the team reached the switcher.
      const inSwitcher = teamIsInSwitcher(
        useWorkspaceStore.getState().workspaces,
        org.slug,
      );
      addToast({
        title: t("inviteInbox.joinedTitle", { team: org.name }),
        description: inSwitcher
          ? t("inviteInbox.joinedBody")
          : t("inviteInbox.joinedBodyUnconfirmed"),
        variant: "success",
      });
    },
    onError: (err) => {
      showInviteFailure(t, err);
      qc.invalidateQueries({ queryKey: queryKeys.orgs() });
    },
  });
}

export function useDeclineInvite() {
  const { t } = useTranslation("teams");
  const qc = useQueryClient();
  return useCallback(
    (inviteId: string) =>
      runOptimisticWrite(
        {
          qc,
          command: "decline_org_invite",
          patches: [
            {
              queryKey: queryKeys.orgs(),
              apply: (list: OrgsList | undefined) =>
                orgsWithoutInvite(list, inviteId),
            },
          ],
          write: () =>
            tauriOrg.declineInvite(inviteId, {
              silence: isExpectedInviteError,
            }),
          failure: {
            title: t("writeFailed.declineInvite.title"),
            description: t("writeFailed.declineInvite.description"),
          },
          onSuccess: () => analytics.track("org_invite_declined"),
        },
        (command, err, copy) =>
          isExpectedInviteError(err)
            ? showInviteFailure(t, err)
            : tellOptimisticRefusal(command, err, copy),
      ),
    [qc, t],
  );
}

/**
 * Surface an expected rejection as its own informational toast. `unknown`
 * failures already reached the user through `call()`'s red toast + Sentry
 * report, so they get nothing extra here (one surface per action).
 */
function showInviteFailure(t: TFunction<"teams">, err: unknown): void {
  const failure = classifyInviteError(err);
  if (failure === "unknown") return;
  const key = FAILURE_COPY[failure];
  showExpectedStateToast(
    t(`inviteInbox.errors.${key}Title`),
    t(`inviteInbox.errors.${key}Body`),
  );
}
