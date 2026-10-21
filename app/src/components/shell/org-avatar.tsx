import {
  AGENT_COLORS,
  type AgentColorId,
  cn,
  colorValue,
} from "@houston-ai/core";
import type { CSSProperties } from "react";

/**
 * The agent palette's tones that carry white initials. An org has no colour
 * of its own yet, so it borrows one, picked from its slug.
 */
const ORG_TONES: readonly AgentColorId[] = [
  "teal",
  "purple",
  "orange",
  "navy",
  "rose",
  "forest",
  "crimson",
];

/** FNV-1a over the slug, so an org wears one tone on every screen. */
export function orgTone(slug: string): AgentColorId {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ORG_TONES[hash % ORG_TONES.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.trim().slice(0, 2);
  return letters.toUpperCase() || "?";
}

const SIZE = {
  md: "size-10 rounded-xl text-[13px]",
  sm: "size-8 rounded-lg text-[11px]",
} as const;

export function OrgAvatar({
  slug,
  name,
  size = "md",
}: {
  slug: string;
  name: string;
  size?: keyof typeof SIZE;
}) {
  const tone = AGENT_COLORS.find((color) => color.id === orgTone(slug));
  return (
    <span
      aria-hidden
      data-tone={tone?.id}
      style={{ "--org-tone": tone && colorValue(tone) } as CSSProperties}
      className={cn(
        "plan-briefing-avatar grid shrink-0 place-items-center font-semibold text-person-initials",
        SIZE[size],
      )}
    >
      {initials(name)}
    </span>
  );
}
