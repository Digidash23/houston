import {
  useSaveWorkspaceContext,
  useWorkspaceContext,
} from "../../hooks/queries/use-workspace-context";
import { useAgentStore } from "../../stores/agents";
import { type ContextSlotState, contextSlotState } from "./context-slot-state";

/** The two halves of the workspace's standing context, as stored on the wire. */
export type ContextSlot = "workspace" | "user";

/**
 * One context slot's editor state: the content, the save, and whether the
 * agent-backed read has landed.
 *
 * Both files live at the OPEN AGENT's workspace root and its runtime reads them
 * into the prompt (see `use-workspace-context`), which is why an agent path is
 * the precondition rather than a workspace id. `state` is `loading` until one
 * resolves, so the surface can show a frame instead of an editor over nothing,
 * and `noAgent` when the workspace has no agent to read through.
 */
export function useContextSlot(slot: ContextSlot): {
  state: ContextSlotState;
  content: string;
  onSave: (next: string) => Promise<void>;
} {
  const agentPath = useAgentStore((s) => s.current?.folderPath);
  const agentsLoaded = useAgentStore((s) => s.loaded);
  const { data } = useWorkspaceContext(agentPath);
  const save = useSaveWorkspaceContext(agentPath);

  return {
    state: contextSlotState({ agentsLoaded, agentPath, hasData: !!data }),
    content: data?.[slot] ?? "",
    onSave: async (next: string) => {
      await save.mutateAsync({ slot, content: next });
    },
  };
}
