import {
  Avatar,
  AvatarFallback,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@houston-ai/core";
import {
  AppSidebar,
  SidebarProfileMenu,
  sidebarHeaderControlClasses,
  useSidebarAvatarDiameter,
} from "@houston-ai/layout";
import { Check, Plus, Search, Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Viewport, workspaces } from "./sample";

/**
 * The scenery around the rail in the `AppSidebar` specimen: the pane it sits
 * beside (so its 272/56px width reads true), the top line and foot the desktop
 * shell fills, and the empty-workspace rail. None of it is the component under
 * study; it is what makes the component readable on the page.
 */

/**
 * What a FOLDED block says on behalf of the rows it is hiding. The library
 * counts nothing and draws nothing: `trailing` is a slot, and this is one
 * plausible thing to put in it.
 */
export function BlockRollup({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} inside`}
      title={`${count} inside`}
      className="rounded-full bg-input/90 px-2 text-[11px] text-ink/80 leading-5"
    >
      {count}
    </span>
  );
}

/** The rail beside the pane it sits next to, so its 272/56px width reads true. */
export function SidebarStage({ children }: { children: ReactNode }) {
  return (
    <Viewport className="h-[520px] w-full max-w-2xl">
      {children}
      <div className="flex flex-1 items-center justify-center p-6 text-center text-ink-muted text-xs">
        The agent's workspace: whatever the selected rail row opens.
      </div>
    </Viewport>
  );
}

function HeaderControl(props: {
  label: string;
  icon: ReactNode;
  collapsed: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          className={sidebarHeaderControlClasses}
        >
          {props.icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side={props.collapsed ? "right" : "bottom"}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** The host's verbs on the rail's top line (`headerActions`). */
export function RailActions({ collapsed }: { collapsed: boolean }) {
  return (
    <>
      <HeaderControl
        label="Search"
        icon={<Search className="size-4" />}
        collapsed={collapsed}
      />
      <HeaderControl
        label="Create"
        icon={<Plus className="size-4" />}
        collapsed={collapsed}
      />
    </>
  );
}

/** A round portrait at the rail slot's diameter, as a host draws one. */
export function Portrait({ initials }: { initials: string }) {
  const diameter = useSidebarAvatarDiameter();
  return (
    <Avatar style={{ width: diameter, height: diameter }}>
      <AvatarFallback className="text-xs font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** The foot the desktop shell fills: an update notice, then the account. */
export function RailFoot({ collapsed }: { collapsed: boolean }) {
  const [workspaceId, setWorkspaceId] = useState("personal");
  const current =
    workspaces.find((one) => one.id === workspaceId) ?? workspaces[0];
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5 text-ink-muted text-xs">
        <Sparkles className="size-3.5 shrink-0" />
        {!collapsed && "Update ready, restart to install"}
      </div>
      <SidebarProfileMenu
        avatar={<Portrait initials="JA" />}
        title="Julian Arango"
        subtitle={current.name}
        collapsed={collapsed}
      >
        {workspaces.map((one) => (
          <DropdownMenuItem
            key={one.id}
            onSelect={() => setWorkspaceId(one.id)}
          >
            {one.id === workspaceId ? (
              <Check className="size-4" />
            ) : (
              <span className="size-4" />
            )}
            {one.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
      </SidebarProfileMenu>
    </div>
  );
}

/** A brand-new workspace: the top line's verbs, and nothing under them. */
export function EmptyRail() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <AppSidebar
      headerActions={<RailActions collapsed={false} />}
      items={[]}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );
}
