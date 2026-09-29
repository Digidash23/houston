import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMyProfile } from "../../hooks/use-my-profile";
import { useSession } from "../../hooks/use-session";
import { useWorkspaceStore } from "../../stores/workspaces";

/**
 * Who is signed in, heading the workspace menu and the account menu
 * (`sidebar-account-menu.tsx`): the name in ink over the email, muted. The
 * email is left out when it is the name already (an account with no display
 * name) or the provider withheld it.
 */
export function SignedInHeader(props: { name: string; email: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-ink text-sm">{props.name}</span>
      {props.email && props.email !== props.name && (
        <span className="truncate text-ink-muted text-xs">{props.email}</span>
      )}
    </span>
  );
}

/**
 * What the workspace switcher heading the phone's More card
 * (`mobile-more-menu.tsx`) draws: the workspace's name, and the person
 * heading its menu. Single-player desktop has no identity, so its menu has no
 * header.
 */
export function useWorkspaceSwitcherFace(): {
  title: string;
  header: ReactNode | undefined;
} {
  const { t } = useTranslation("shell");
  const profile = useMyProfile();
  const { data: session } = useSession();
  const current = useWorkspaceStore((s) => s.current);
  const title = current?.name ?? t("sidebar.selectWorkspace");
  return {
    title,
    header: profile ? (
      <SignedInHeader name={profile.name} email={session?.email ?? ""} />
    ) : undefined,
  };
}
