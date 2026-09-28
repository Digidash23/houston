import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@houston-ai/core";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { useMyProfile } from "../../hooks/use-my-profile";
import { hasSpaces } from "../../lib/org-roles";
import { useWorkspaceStore } from "../../stores/workspaces";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { SidebarProfileAvatar } from "./sidebar-profile-avatar";

/**
 * The account row and its workspace run, shared by the desktop rail's foot
 * (`sidebar-workspace-menu.tsx`) and the head of the phone's More card
 * (`mobile-more-menu.tsx`), so the two breakpoints show the same person, the
 * same workspace line and the same switch-or-create choices.
 */

/**
 * Radix restores focus to the trigger when the menu's content unmounts, so a
 * handler that moves the view synchronously gets that focus yanked back to the
 * trigger. Running it one tick later lets the menu close first.
 */
function afterClose(run: () => void): () => void {
  return () => setTimeout(run, 0);
}

/** One menu row: a leading glyph column, a truncating label. */
export function MenuItemRow(props: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  dataAttrs?: Record<string, string>;
}) {
  return (
    <DropdownMenuItem
      onSelect={afterClose(props.onSelect)}
      {...props.dataAttrs}
    >
      {props.icon}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </DropdownMenuItem>
  );
}

/**
 * Who is signed in and where, as the account row draws it: the person's
 * portrait and name over the workspace they are in. Single-player desktop has
 * no identity, so there the workspace takes the name line alone, beside a
 * plain person glyph.
 */
export function useAccountFace(): {
  avatar: ReactNode;
  title: string;
  subtitle: string | undefined;
} {
  const { t } = useTranslation("shell");
  const profile = useMyProfile();
  const current = useWorkspaceStore((s) => s.current);
  const workspaceName = current?.name ?? t("sidebar.selectWorkspace");
  return {
    avatar: (
      <SidebarProfileAvatar
        name={profile?.name ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
      />
    ),
    title: profile?.name ?? workspaceName,
    subtitle: profile ? workspaceName : undefined,
  };
}

/**
 * Creating a workspace, routed on `capabilities.spaces` (C8): a hosted
 * deployment that serves Spaces opens the create-organization dialog, which
 * this hook mounts (`dialog`); anywhere else it runs the host's local
 * workspace-create (`onCreateLocal`).
 */
export function useWorkspaceCreate(onCreateLocal: () => void): {
  label: string;
  onCreate: () => void;
  dialog: ReactNode;
} {
  const { t } = useTranslation(["shell", "teams"]);
  const { capabilities } = useCapabilities();
  const spacesEnabled = hasSpaces(capabilities);
  const [open, setOpen] = useState(false);
  return {
    label: spacesEnabled
      ? t("teams:createTeam.trigger")
      : t("shell:sidebar.createWorkspace"),
    onCreate: spacesEnabled ? () => setOpen(true) : onCreateLocal,
    dialog: spacesEnabled ? (
      <CreateOrganizationDialog open={open} onOpenChange={setOpen} />
    ) : null,
  };
}

/**
 * Every workspace the person belongs to, the current one checked, then
 * create. macOS's own idiom for "one of these is current": a checkmark in the
 * leading column, an empty column for the rest, so every name lines up. A
 * checkbox item, so a screen reader hears which one is current too.
 */
export function WorkspaceSwitchItems(props: {
  onSwitch: (workspaceId: string) => void;
  createLabel: string;
  onCreate: () => void;
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentId = useWorkspaceStore((s) => s.current?.id ?? null);
  return (
    <>
      {workspaces.map((workspace) => (
        <DropdownMenuCheckboxItem
          key={workspace.id}
          checked={workspace.id === currentId}
          onSelect={afterClose(() => props.onSwitch(workspace.id))}
        >
          <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <MenuItemRow
        icon={<Plus className="size-4" aria-hidden="true" />}
        label={props.createLabel}
        onSelect={props.onCreate}
      />
    </>
  );
}
