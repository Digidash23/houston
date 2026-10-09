import { useCapabilities } from "../../hooks/use-capabilities";
import type { Agent, SkillSummary } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaces";
import type {
  ManagedSkillRow,
  SharedDialogActions,
} from "./skill-editor-props";
import { useSharedSkills } from "./use-shared-skills";
import { useSharedSkillsActions } from "./use-shared-skills-actions";
import { useWorkspaceSkills } from "./use-workspace-skills";

/**
 * The skills the surface lists and the writes it commits, for the agents it is
 * given: the one employee for its own Skills section, or every employee for
 * the editor menu's acts that reach them all.
 *
 * Store-backed when the deployment serves the workspace-shared skills store
 * (ADR 0003); otherwise the copy-based model, where a skill lives on each
 * agent. Both are read here so the surface itself never branches on it.
 */
export interface SkillsModels {
  rows: ManagedSkillRow[];
  /** folderPath → that agent's list, which the setup chat needs. */
  listsByPath: Map<string, SkillSummary[] | undefined>;
  loading: boolean;
  /** Every agent's read answered, so a row names every holder. */
  complete: boolean;
  failed: boolean;
  /** Read every source again — the user-initiated retry. */
  retry: () => void;
  /** Store handlers, present exactly when the deployment shares. */
  shared: SharedDialogActions | undefined;
}

export function useSkillsModels(agents: Agent[]): SkillsModels {
  const workspaceId = useWorkspaceStore((s) => s.current?.id ?? null);
  const { capabilities } = useCapabilities();
  const sharedMode =
    capabilities?.sharedSkills === true && workspaceId !== null;
  const copyModel = useWorkspaceSkills(agents);
  const sharedModel = useSharedSkills({
    enabled: sharedMode,
    workspaceId,
    agents,
    listsByPath: copyModel.listsByPath,
  });
  const sharedActions = useSharedSkillsActions(workspaceId);

  const shared: SharedDialogActions | undefined =
    sharedMode && workspaceId !== null
      ? {
          workspaceId,
          onApply: sharedActions.applyShared,
          onDelete: (row) => sharedActions.deleteShared(row, agents),
          onRevert: sharedActions.revertOverride,
          onDisableForAgent: sharedActions.disableForAgent,
          onEnableAll: (row) => sharedActions.enableForAll(row, agents),
          onAddToAgent: sharedActions.addToAgent,
          onPromote: sharedActions.promoteToShared,
        }
      : undefined;

  return {
    rows: sharedMode ? sharedModel.rows : copyModel.rows,
    listsByPath: copyModel.listsByPath,
    loading: sharedMode
      ? copyModel.loading || sharedModel.loading
      : copyModel.loading,
    complete: copyModel.complete && sharedModel.complete,
    failed: sharedMode
      ? copyModel.failed || sharedModel.failed
      : copyModel.failed,
    // Both models, because either can be the one that did not answer — but an
    // explicit refetch runs a DISABLED query too, so asking the store where the
    // deployment serves none would call the unsupported route and report a
    // second failure over the first.
    retry: () => {
      copyModel.retry();
      if (sharedMode) sharedModel.retry();
    },
    shared,
  };
}
