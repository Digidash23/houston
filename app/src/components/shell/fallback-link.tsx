import { cn } from "@houston-ai/core";
import { isTauri } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { openLinkOutside } from "../../lib/external-link-click";
import { openExternalUrl } from "../../lib/open-external-url";

/**
 * The link offered when a Stripe page (checkout, billing portal) did not open
 * on its own. One component for every such link, so its look, its focus ring
 * and its way out of the app cannot drift between surfaces.
 */
export function FallbackLink({
  href,
  command,
  tone = "link",
  className,
  children,
}: {
  href: string;
  /** Triage tag for a failed open on desktop. */
  command: string;
  /** `ink` keeps the link in the sentence's own color, for fine print. */
  tone?: "link" | "ink";
  /** Placement only (alignment, spacing, text size). */
  className?: string;
  /** Absent when a `<Trans>` slot supplies the words. */
  children?: ReactNode;
}) {
  return (
    <a
      className={cn(
        "rounded-full underline outline-none focus-visible:ring-2 focus-visible:ring-focus",
        tone === "link"
          ? "text-link"
          : "font-medium text-ink underline-offset-2",
        className,
      )}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) =>
        openLinkOutside(event, href, {
          desktop: isTauri(),
          open: (url) => openExternalUrl(url, { command }),
        })
      }
    >
      {children}
    </a>
  );
}
