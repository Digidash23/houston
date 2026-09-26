import { ASSISTANT_VIEW_ID } from "../assistant/id";

/**
 * The employees band's lit row. The band has ONE selection, shared by the
 * pinned Manager and the agents: the Manager while its view is open, otherwise
 * whichever agent the teams model lit.
 */
export function bandSelectedId(
  viewMode: string,
  selectedAgentId: string | null,
): string | null {
  return viewMode === ASSISTANT_VIEW_ID ? ASSISTANT_VIEW_ID : selectedAgentId;
}

/** Where a band row click goes: the Manager's id opens its view, any other id
 *  is an agent. */
export function routeBandSelect(
  id: string,
  to: { openManager: () => void; selectAgent: (agentId: string) => void },
): void {
  if (id === ASSISTANT_VIEW_ID) to.openManager();
  else to.selectAgent(id);
}
