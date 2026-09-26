import { useState } from "react";
import { TEAM_CHOICE, type TeamView } from "./team-view-model";

/** How the incoming screen arrives: from the side the move travels. */
export type TeamMoveDirection = "forward" | "back";

export interface TeamNavigation {
  view: TeamView;
  direction: TeamMoveDirection;
  go: (next: TeamView) => void;
  back: (previous: TeamView) => void;
}

/** Where the card stands, and the side the last move came from. */
export function useTeamNavigation(): TeamNavigation {
  const [view, setView] = useState<TeamView>(TEAM_CHOICE);
  const [direction, setDirection] = useState<TeamMoveDirection>("forward");

  return {
    view,
    direction,
    go: (next) => {
      setDirection("forward");
      setView(next);
    },
    back: (previous) => {
      setDirection("back");
      setView(previous);
    },
  };
}
