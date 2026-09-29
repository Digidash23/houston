import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@houston-ai/core";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCapabilities } from "../../hooks/use-capabilities";
import { hasSpaces } from "../../lib/org-roles";
import { useWorkspaceStore } from "../../stores/workspaces";
import { CreateOrganizationDialog } from "./create-organization-dialog";

/**
 * The workspace menu's rows, shared by the rail's account row at its foot
 * (`sidebar-workspace-menu.tsx`) and the head of the phone's More card
 * (`mobile-more-menu.tsx`), so the two breakpoints offer the same
 * switch-or-create choices. The switcher's own face is
 * `workspace-switcher-face.tsx`.
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
