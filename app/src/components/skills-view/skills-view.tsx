import { useIsMobile } from "@houston-ai/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../../lib/types";
import { useAgentStore } from "../../stores/agents";
import { effectiveSkillsByPath } from "./effective-skills";
import { SkillDraftRows } from "./skill-draft-rows";
import { SkillEditorPage } from "./skill-editor-page";
import { SkillsListSkeleton, SkillsRetryEmpty } from "./skills-list-states";
import { SkillsReady } from "./skills-ready";
import { SkillsSurfaceFrame } from "./skills-surface-frame";
import { useAddExistingSkill } from "./use-add-existing-skill";
import { useScopedSkillRows } from "./use-scoped-skill-rows";
import { useSkillCreateFlow } from "./use-skill-create-flow";
import { useSkillsEditorNav } from "./use-skills-editor-nav";
import { useSkillsModels } from "./use-skills-models";
import { useSkillsViewActions } from "./use-skills-view-actions";
import { useUnfinishedSkillDrafts } from "./use-unfinished-skill-drafts";
import { useWorkspaceSkillRows } from "./workspace-skill-rows";

/**
 * One AI Employee's Skills, the section in its settings rail: the skills it
 * has, a search, and a "Create skill" menu whose second way puts a skill the
 * workspace already holds on this employee. It stands inside the frame the
 * rail already provides.
 *
 * Clicking a skill replaces the list with that skill's EDITOR: its workflow
 * (or markdown) here, its chat in the shell's right panel. The editor brings
 * its OWN header, whose back arrow returns the list. "Create skill" opens the
 * guided create chat in the same panel with the list still on the left.
 */
export function SkillsBody({ agent }: { agent: Agent }) {
  const { t } = useTranslation("skills");
  const workspaceAgents = useAgentStore((s) => s.agents);
  const agents = useMemo(() => [agent], [agent]);
  const models = useSkillsModels(agents);
  // The shared store lists every skill it holds, so the surface drops the
  // ones this employee does not load and points what is left at the copy that
  // employee runs; the copy-based model is already narrow.
  const rows = useScopedSkillRows(models.rows, models.listsByPath, agent);
  const actions = useSkillsViewActions();
  const [query, setQuery] = useState("");

  // The panel COVERS the content below md, so a phone opens the chat on
  // demand instead of burying the editor the tap just opened.
  const isMobile = useIsMobile();
  // The chat host and the editor nav each need the other: the chat's "Edit
  // manually" drives the left pane, and entering the editor opens the chat.
  // A ref breaks the cycle without a second render.
  const openTextRef = useRef<(slug: string) => void>(() => {});
  const onEditSkill = useCallback((slug: string) => {
    openTextRef.current(slug);
  }, []);
  // The chat is fed what each employee RUNS, not just its own copies: a
  // workspace skill it loads has no copy, and its chat has to find it.
  const skillsByPath = useMemo(
    () =>
      effectiveSkillsByPath({
        rows: models.rows,
        listsByPath: models.listsByPath,
      }),
    [models.rows, models.listsByPath],
  );
  const create = useSkillCreateFlow({
    agent,
    skillsByPath,
    skillsFailed: models.failed,
    onEditSkill,
  });
  // Reads the UNSCOPED rows: a workspace skill this employee does not have
  // yet is exactly what the dialog offers, and scoping already dropped it.
  const addExisting = useAddExistingSkill({
    agent,
    rows: models.rows,
    shared: models.shared,
    loading: models.loading,
    failed: models.failed,
    onRetry: models.retry,
  });
  const nav = useSkillsEditorNav({
    rows,
    rowsLoaded: !models.loading,
    openChat: create.openForSkill,
    closeChat: create.close,
    autoOpenChat: !isMobile,
  });
  openTextRef.current = nav.openText;

  const { installed, installedCount } = useWorkspaceSkillRows({
    rows,
    query,
    onOpenEditor: nav.open,
  });
  // A creation chat closed before the skill exists is listed here or nowhere:
  // setup chats are kept off every mission board. It sits ABOVE the skills as
  // the thing still being made, out of their count and their search.
  const drafts = useUnfinishedSkillDrafts(
    agent,
    skillsByPath,
    create.openActivityId,
  );
  const editing = nav.editing;

  return (
    <>
      {editing ? (
        <SkillEditorPage
          key={editing.slug}
          row={editing}
          workspaceAgents={workspaceAgents}
          agent={agent}
          onApply={actions.applySkillChanges}
          onDeleteEverywhere={actions.deleteSkillEverywhere}
          shared={models.shared}
          view={nav.view}
          onViewChange={nav.setView}
          onBack={nav.close}
          onOpenChat={
            !create.open && editing.agents.length > 0
              ? () => create.openForSkill(editing)
              : undefined
          }
        />
      ) : (
        <SkillsSurfaceFrame dataAttrs={{ "data-skills-list": "agent" }}>
          {models.loading && rows.length === 0 ? (
            <SkillsListSkeleton />
          ) : models.failed && rows.length === 0 ? (
            // Rows that DID land keep the list: a partial read is still the
            // user's skills, and the failure was already toasted.
            <SkillsRetryEmpty
              title={t("global.loadFailedTitle")}
              description={t("global.loadFailedDescription")}
              onRetry={models.retry}
            />
          ) : (
            <SkillsReady
              query={query}
              onQueryChange={setQuery}
              onCreateWithChat={create.startChat}
              onAddExisting={addExisting.start}
              drafts={
                <SkillDraftRows drafts={drafts} onOpen={create.openDraft} />
              }
              installed={installed}
              installedCount={installedCount}
            />
          )}
        </SkillsSurfaceFrame>
      )}
      {create.node}
      {addExisting.node}
    </>
  );
}
