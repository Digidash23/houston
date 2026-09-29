/**
 * The closed vocabulary of `data-tour-target` anchors the guided surfaces use.
 *
 * A caller names one of these and builds its selector with `tourSelector`,
 * never a hand-written string, so a typo is a compile error instead of a
 * spotlight that silently finds nothing. Every name here is rendered by a real
 * element, at most one on screen at a time:
 *
 * - The rail (desktop): `@houston-ai/layout`'s sidebar (`agents`, the list);
 *   `sidebar-header-actions.tsx` (`newAgent`, the top line's "+");
 *   `connect-group.tsx` (`nav-integrations` and `nav-ai-hub`, the connect
 *   rows at the foot); `sidebar-workspace-menu.tsx` (`workspaceMenu`, the
 *   account row closing the rail, whose menu holds `nav-academy` and
 *   `nav-settings`, built by `sidebar-nav-rows.tsx`).
 * - The phone's More card, `mobile-more-menu.tsx`: the same connect group
 *   and the same Academy and Settings, as rows.
 * - The phone's own controls: `agents-home-header.tsx` (`newAgent`, the AI
 *   Employees list's create button) and `mobile-nav-bar.tsx` (`newMission`,
 *   the round compose beside the pill; `mobileMenu`, the More button; and
 *   `mobileAgentsTab`, the item that opens the Agents home).
 * - Either screen: `workspace-shell.tsx` (`main`), `new-mission-button.tsx`
 *   (`newMission` on desktop), and the task chat, `shell-panel-card.tsx`
 *   (`taskChat`, the desktop detail panel) and `mission-chat-screen.tsx`
 *   (`taskChat`, the phone's pushed chat).
 *
 * The vocabulary is shared: the Academy's lessons spotlight these anchors
 * (`components/academy/lessons/registry.ts`) and the e2e specs address the
 * shell by them.
 */
export const TOUR_TARGETS = [
  "workspaceMenu",
  "agents",
  "main",
  "newMission",
  "nav-integrations",
  "nav-ai-hub",
  "nav-settings",
  "nav-academy",
  "newAgent",
  "mobileMenu",
  "mobileAgentsTab",
  "taskChat",
] as const;

export type TourTarget = (typeof TOUR_TARGETS)[number];

/** The selector a spotlight queries to find a target. */
export function tourSelector(target: TourTarget): string {
  return `[data-tour-target='${target}']`;
}

/**
 * The send button of the composer inside a target. `ui/chat` marks it with
 * `data-composer-submit`, since a props-only package cannot carry an app
 * anchor.
 */
export function composerSendSelector(within: TourTarget): string {
  return `${tourSelector(within)} [data-composer-submit]`;
}

/**
 * The DOM attributes that make an element a spotlight anchor. Every producer
 * spreads this instead of writing the attribute by hand, so the anchor and the
 * step that spotlights it are checked against the SAME union: deleting a target
 * without deleting its step (or renaming one side only) is a compile error, not
 * a spotlight that silently points at nothing.
 */
export function tourAnchor(target: TourTarget): {
  "data-tour-target": TourTarget;
} {
  return { "data-tour-target": target };
}
