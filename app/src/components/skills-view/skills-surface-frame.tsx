import { CATALOG_PLANE_MAX_W, cn } from "@houston-ai/core";
import type { ReactNode } from "react";

/**
 * Where the Skills surface stands: an employee's Skills section in the
 * settings rail, which already provides the strip and the scroller, so the
 * surface adds only its optional header and the content plane (a second
 * scroller there would trap the content in a short inner window).
 */
export function SkillsSurfaceFrame({
  header,
  contentClassName,
  dataAttrs,
  children,
}: {
  /** The header the surface brings (the editor's own). */
  header?: ReactNode;
  /** Extra layout on the content plane itself (the editor stacks its cards). */
  contentClassName?: string;
  dataAttrs?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div {...dataAttrs}>
      {header}
      <div
        className={cn("mx-auto w-full", CATALOG_PLANE_MAX_W, contentClassName)}
      >
        {children}
      </div>
    </div>
  );
}
