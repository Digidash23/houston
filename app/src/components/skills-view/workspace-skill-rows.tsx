import {
  CATALOG_INSTALLED_PREVIEW_CAP,
  CatalogGrid,
  CatalogRow,
  CatalogShowMore,
} from "@houston-ai/core";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { skillDisplayTitle } from "../../lib/humanize-skill-name";
import { installedPreview } from "../../lib/installed-preview";
import {
  filterWorkspaceSkills,
  type WorkspaceSkillAgent,
  type WorkspaceSkillRow,
} from "../../lib/workspace-skills";
import { SkillIcon } from "../skill-icon";
import { resolveSkillsListState } from "./skills-list-model";
import { SkillsListEmpty } from "./skills-list-states";

/** Rows carry the store fields when the deployment shares (ADR 0003). */
type PageSkillRow = WorkspaceSkillRow & {
  origin?: "shared" | "local";
  overriddenBy?: WorkspaceSkillAgent[];
};

/**
 * The **Your skills** strip of an employee's Skills section: one row per
 * slug, opening that skill's full-page editor in place of the list.
 * Preview-capped behind "Show all" at rest; an active query drops the cap.
 * With nothing to list it renders the empty state, so the section never
 * collapses to a bare search field.
 */
export function useWorkspaceSkillRows({
  rows,
  query,
  onOpenEditor,
}: {
  rows: PageSkillRow[];
  query: string;
  /** Open the skill's editor (the list steps aside for it). */
  onOpenEditor: (row: PageSkillRow) => void;
}): { installedCount: number; installed: ReactNode } {
  const { t } = useTranslation("skills");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(
    () => filterWorkspaceSkills(rows, query),
    [rows, query],
  );
  const searching = query.trim() !== "";
  const { visible, showExpander } = installedPreview(filtered, {
    searching,
    expanded,
    cap: CATALOG_INSTALLED_PREVIEW_CAP,
  });

  const state = resolveSkillsListState({
    total: rows.length,
    matched: filtered.length,
  });

  const installed =
    state !== "rows" ? (
      <SkillsListEmpty state={state} query={query} />
    ) : (
      <>
        <CatalogGrid>
          {visible.map((row) => (
            <CatalogRow
              key={row.slug}
              icon={
                <SkillIcon
                  image={row.summary.image}
                  bubbleClassName="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-line-input"
                />
              }
              title={skillDisplayTitle(row.summary)}
              description={row.summary.description || undefined}
              trailing={
                <div className="flex shrink-0 items-center gap-2">
                  {row.origin === "shared" && (
                    <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-medium text-chip-text">
                      {t("grid.sharedBadge")}
                    </span>
                  )}
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-ink-muted"
                  />
                </div>
              }
              onClick={() => onOpenEditor(row)}
            />
          ))}
        </CatalogGrid>
        {showExpander && (
          <CatalogShowMore onClick={() => setExpanded(true)}>
            {t("grid.showAllSkills", { count: filtered.length })}
          </CatalogShowMore>
        )}
      </>
    );

  return { installedCount: filtered.length, installed };
}
