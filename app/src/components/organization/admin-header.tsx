import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../shell/page-header/page-header";
import type { HeaderThresholds } from "../shell/page-header/page-header-layout";
import { PageHeaderSwitcher } from "../shell/page-header/page-header-switcher";
import { PageHeaderTabs } from "../shell/page-header/page-header-tabs";
import { usePageHeaderTabsCollapsed } from "../shell/page-header/page-header-tools";
import { DEFAULT_ORG_TAB, type OrgTabId } from "./org-view-model";

/**
 * The widest forms are Spanish. Lozenges: identity "Espacio de trabajo" ~171px
 * (glyph 16 + 6 gap + text + px-3), Personas ~84, Facturación ~99, Actividad
 * ~86, plus 3 × 2px gaps and the track's 4px padding ≈ 450. Tools: the
 * "Contexto de la empresa" pill ~202 (px-2.5 each side, glyph 16 + 6 gap, text
 * ~158, 2px border). `450 + 12 (zone gap) + 202 + 40 (px-5) = 704`, rounded UP
 * to 720. Below it the pill takes the body row; the cluster keeps the strip.
 */
export const ADMIN_HEADER_THRESHOLDS: HeaderThresholds = {
  oneRowMin: 720,
};

/**
 * The Admin strip, in the shared header grammar (Integrations, the team
 * screen): one lozenge cluster where the identity IS the first section.
 *
 * **"Workspace" is the first lozenge.** It wears the Admin row's mark
 * (`Building2`), so the door and the page agree on what this place looks
 * like, carries the screen's `<h1>`, and stands for the Org chart, the landing
 * section: the workspace drawn whole is what this place looks like when you
 * arrive. The other sections follow as plain lozenges; a personal space has
 * none, so its strip is the identity alone.
 *
 * Phone: the cluster collapses into the identity switcher, whose menu names
 * every section, Org chart included, because inside a list of section names
 * "the identity lozenge stands for it" stops being legible.
 */
export function AdminHeader({
  active,
  visibleIds,
  onSelect,
}: {
  active: OrgTabId;
  /** The sections visible for this caller + space, from `orgTabIds`. */
  visibleIds: readonly OrgTabId[];
  onSelect: (id: OrgTabId) => void;
}) {
  const { t } = useTranslation("teams");
  const collapsed = usePageHeaderTabsCollapsed();

  const identity = (
    <>
      <Building2 aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{t("org.title")}</span>
    </>
  );
  const tabs = visibleIds.map((id) =>
    id === DEFAULT_ORG_TAB
      ? {
          id,
          heading: true,
          label: identity,
          dataAttrs: { "data-admin-section-tab": id },
        }
      : {
          id,
          label: t(`org.tabs.${id}`),
          dataAttrs: { "data-admin-section-tab": id },
        },
  );
  const switcherSections = visibleIds.map((id) => ({
    id,
    label: t(`org.tabs.${id}`),
    dataAttrs: { "data-admin-section-tab": id },
  }));

  return (
    <PageHeader>
      {collapsed ? (
        <PageHeaderSwitcher
          identity={identity}
          items={switcherSections}
          active={active}
          label={t("org.tabs.label")}
          onSelect={onSelect}
          dataAttrs={{ "data-admin-section-switcher": "" }}
        />
      ) : (
        <PageHeaderTabs
          items={tabs}
          active={active}
          label={t("org.tabs.label")}
          onSelect={onSelect}
        />
      )}
    </PageHeader>
  );
}
