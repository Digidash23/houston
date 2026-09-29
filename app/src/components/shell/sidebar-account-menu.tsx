import { initialsFor } from "@houston-ai/board";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@houston-ai/core";
import { CircleUserRound, LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMyProfile } from "../../hooks/use-my-profile";
import { useProfileAvailable } from "../../hooks/use-profile-available";
import { useSession } from "../../hooks/use-session";
import { signOut } from "../../lib/auth";
import { logAndReportError } from "../../lib/error-report";
import type { NavMode } from "../../lib/nav-stack";
import { useUIStore } from "../../stores/ui";
import {
  ABOUT_ME_VIEW_ID,
  type AccountViewId,
  PROFILE_VIEW_ID,
} from "../account/id";
import { MenuItemRow } from "./workspace-account";
import { SignedInHeader } from "./workspace-switcher-face";

/**
 * The signed-in person's round portrait at the phone row's 20px glyph size: their
 * photo, else their initials. Single-player desktop has no identity, so it
 * draws a plain person glyph instead, like any other icon in the card.
 */
function AccountAvatar(props: { name: string; avatarUrl: string | null }) {
  return (
    <Avatar className="size-5">
      {props.avatarUrl && (
        <AvatarImage
          src={props.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="font-medium text-xs">
        {initialsFor(props.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** The person's own menu, in the parts a host arranges (`useAccountMenu`). */
export interface AccountMenuParts {
  label: string;
  /** The portrait at the phone row's 20px glyph size. */
  avatar: ReactNode;
  /** Who is signed in, then a separator; null without an identity. */
  header: ReactNode;
  /** Profile (where served) and About me. */
  personal: ReactNode;
  /** A separator, then Sign out; null without an identity. */
  signOut: ReactNode;
  /** The whole menu, the parts in order: what the phone's account row opens. */
  menu: ReactNode;
}

/**
 * The person's own menu, shared by the rail's account row
 * (`sidebar-workspace-menu.tsx`, which sets its parts among the workspaces
 * and the destinations) and the phone's More card (`mobile-more-row.tsx`, the
 * account row, which opens `menu` whole), so both breakpoints offer the same
 * things.
 *
 * Headed by who is signed in, it holds what the account itself needs: the
 * person's Profile (name and picture, where the deployment serves it), About
 * me (what every AI Employee knows about them) and Sign out. It is the ONLY
 * door onto all three: Profile and About me are top-level screens of their
 * own (`account/`), and Settings carries none of them. Single-player desktop
 * has no identity: no header, no Profile, no Sign out, only About me.
 */
export function useAccountMenu(opts: {
  /** How a screen lands on the nav stack; the phone passes `reset`. */
  nav?: NavMode;
  /** Runs after every navigation: closes the phone's More card. */
  onNavigate: () => void;
}): AccountMenuParts {
  const { t } = useTranslation("shell");
  const profile = useMyProfile();
  const { data: session } = useSession();
  const profileAvailable = useProfileAvailable();
  const setViewMode = useUIStore((s) => s.setViewMode);
  const open = (view: AccountViewId) => {
    setViewMode(view, { nav: opts.nav });
    opts.onNavigate();
  };
  const header = profile && (
    <>
      <DropdownMenuLabel className="font-normal">
        <SignedInHeader name={profile.name} email={session?.email ?? ""} />
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
    </>
  );
  const personal = (
    <>
      {profileAvailable && (
        <MenuItemRow
          icon={<CircleUserRound className="size-4" aria-hidden="true" />}
          label={t("accountMenu.profile")}
          onSelect={() => open(PROFILE_VIEW_ID)}
        />
      )}
      <MenuItemRow
        icon={<UserRound className="size-4" aria-hidden="true" />}
        label={t("accountMenu.aboutMe")}
        onSelect={() => open(ABOUT_ME_VIEW_ID)}
      />
    </>
  );
  const signOutRow = profile && (
    <>
      <DropdownMenuSeparator />
      <MenuItemRow
        icon={<LogOut className="size-4" aria-hidden="true" />}
        label={t("accountMenu.signOut")}
        dataAttrs={{ "data-testid": "account-sign-out" }}
        onSelect={() => {
          // `signOut` also surfaces its failure on the auth-error bus,
          // which the sign-in screen replacing the app renders.
          void signOut().catch((e: unknown) =>
            logAndReportError("account-sign-out", e),
          );
        }}
      />
    </>
  );
  return {
    label: t("sidebar.account"),
    avatar: profile ? (
      <AccountAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
    ) : (
      <UserRound className="size-4" aria-hidden="true" />
    ),
    header: header || null,
    personal,
    signOut: signOutRow || null,
    menu: (
      <>
        {header}
        {personal}
        {signOutRow}
      </>
    ),
  };
}
