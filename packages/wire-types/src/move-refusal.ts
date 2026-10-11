/**
 * The gateway's answers to `POST /v1/agents/:slug/move` when the source space
 * cannot start the move. They are coded so a client never keys on the status
 * or the English `error`:
 *
 *  - `agent_moved` (409): the agent's live row already sits in the requested
 *    target space. The move the client asks for is done (a resumed move whose
 *    ticket expired, or a race with the move finishing), so a client clears
 *    its record of the move instead of sending it again.
 *  - `agent_not_found` (404): the agent lives in neither space and no move
 *    holds it, so nothing is left to move or resume: a client clears its
 *    record too.
 *  - `agent_not_ready` (409): the source still holds the agent in a state no
 *    move starts from (still being created). A client keeps its record.
 *
 * An older gateway answers all three as an uncoded
 * `404 {error: "agent not found"}`, which a client keeps.
 */
export type MoveGoneCode = "agent_moved" | "agent_not_found";

export const AGENT_MOVED = "agent_moved" satisfies MoveGoneCode;

export const AGENT_NOT_FOUND = "agent_not_found" satisfies MoveGoneCode;
