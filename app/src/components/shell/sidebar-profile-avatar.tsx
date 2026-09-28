import { initialsFor } from "@houston-ai/board";
import { Avatar, AvatarFallback, AvatarImage } from "@houston-ai/core";
import { useSidebarAvatarDiameter } from "@houston-ai/layout";
import { UserRound } from "lucide-react";

/**
 * The signed-in person's round portrait at the rail slot's diameter: their
 * photo, else their initials, else (single-player, no identity) a plain
 * person glyph. The same circle Settings draws at its head
 * (`settings/identity-header.tsx`), so the face is one face everywhere.
 */
export function SidebarProfileAvatar(props: {
  name: string | null;
  avatarUrl: string | null;
}) {
  const diameter = useSidebarAvatarDiameter();
  return (
    <Avatar style={{ width: diameter, height: diameter }}>
      {props.avatarUrl && (
        <AvatarImage
          src={props.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="text-xs font-medium">
        {props.name ? (
          initialsFor(props.name)
        ) : (
          <UserRound className="size-4" aria-hidden="true" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
