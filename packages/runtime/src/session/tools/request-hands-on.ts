import { defineTool } from "@earendil-works/pi-coding-agent";
import type { HandsOnSurface } from "@houston/protocol";
import { HANDS_ON_SURFACES, isHandsOnSurface } from "@houston/protocol";
import { Type } from "typebox";
import { houstonApiServedHere } from "../houston-api-served";
import { recordHandsOn } from "../interaction";
import { assertNotPlanMode } from "../live-mode-gate";

export const REQUEST_HANDS_ON_TOOL_NAME = "request_hands_on";

/**
 * The screens that are the person's OWN to open: what they pay and what they
 * can destroy. Every other errand is Houston asking for a hand with work the
 * agent was already given; these two are the person's standing over their
 * money and their space.
 *
 * The card carries a MODEL-AUTHORED reason rendered in Houston's own chrome, so
 * an ordinary mission agent — one that reads web pages, mail and documents all
 * turn — could be talked into dressing a trip to Billing or the Danger zone as
 * Houston's own idea. The AI Manager is the one runtime the HOST itself named
 * to operate the account, which is the same structural line `credentialTools`
 * draws, so it alone may hand these two over.
 */
const ACCOUNT_OWNER_SURFACES: ReadonlySet<HandsOnSurface> = new Set([
  "billing",
  "orgDanger",
]);

/**
 * The screens that belong to ONE AI Employee, named by the id `listAgents`
 * returns. Only the AI Manager reads the roster, so an ordinary agent asked for
 * one could only guess the id, and a card that lands on the wrong employee
 * hands the person the wrong IDs to paste into their code.
 */
const AGENT_SURFACES: ReadonlySet<HandsOnSurface> = new Set(["agentApiAccess"]);

export interface RequestHandsOnToolOptions {
  /** True when this runtime IS the user's personal assistant (the AI Manager). */
  personalAssistant: boolean;
  /** Whether this deployment serves the Houston API; read from the host's
   *  unserved stamp when omitted. Without it there is no API access screen. */
  apiServed?: boolean;
}

/**
 * Hand a Houston screen to the person because the work there needs THEIR hands:
 * a card the model must never hold, a secret revealed once in a dialog the app
 * owns, files that exist only on their device, a space they alone may destroy.
 * One card covers all of them — each is the same interaction ("open this
 * screen, do the thing, come back"), and none can carry its result back through
 * the runtime, so four bespoke step kinds would buy nothing.
 *
 * KNOWN DEGRADATION: a build that predates this step kind drops it on the way in
 * (`parsePendingInteraction` keeps only the kinds it recognizes), so the turn
 * ends with nothing on screen. Accepted: the alternative is the model narrating
 * the clicks in chat, which is exactly what this tool exists to replace.
 */
export function makeRequestHandsOnTool({
  personalAssistant,
  apiServed = houstonApiServedHere(),
}: RequestHandsOnToolOptions) {
  // An employee's own screen needs the roster (the Manager) AND the API.
  const agentScreens = personalAssistant && apiServed;
  const offered = HANDS_ON_SURFACES.filter((surface) =>
    AGENT_SURFACES.has(surface)
      ? agentScreens
      : personalAssistant || !ACCOUNT_OWNER_SURFACES.has(surface),
  );
  const surfaceList = offered.join(", ");
  const errands = personalAssistant
    ? agentScreens
      ? "pay or change a plan, copy a key the app shows once, pick files from their device, copy a routine's webhook, destroy a shared space, or connect one AI Employee to their own code or another AI assistant (agentApiAccess opens that employee's API access screen: its IDs and a ready setup prompt for an AI coding assistant; pass the employee's id from listAgents as agent)"
      : "pay or change a plan, copy a key the app shows once, pick files from their device, copy a routine's webhook, or destroy a shared space"
    : "copy a key the app shows once, pick files from their device, or copy a routine's webhook";
  return defineTool({
    name: REQUEST_HANDS_ON_TOOL_NAME,
    label: "Hand an app screen to the user",
    description: `Send the user to a screen in the app to finish something only they can do there: ${errands}. The app shows a card that opens the screen for them and asks them to confirm when they are finished. Valid screens: ${surfaceList}. Never describe the clicks in chat and never ask them to paste a secret into the conversation. Queue the card, finish independent work, then end your turn.`,
    parameters: Type.Object({
      surface: Type.String(),
      agent: Type.Optional(
        Type.String({
          description:
            "The AI Employee's id from listAgents. Required for agentApiAccess; ignored for every other screen.",
        }),
      ),
      reason: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    async execute(
      _id: string,
      params: { surface: string; agent?: string; reason?: string },
    ) {
      assertNotPlanMode("hand a screen to the user");
      const surface = params.surface.trim();
      // Refused HERE, where the model can correct course: a screen the app
      // cannot open renders a card with no way forward, blocking the composer
      // until the user hits Skip (the same lesson as the hidden provider ids).
      if (!isHandsOnSurface(surface))
        throw new Error(
          `The app has no '${params.surface}' screen to hand over. Use one of: ${surfaceList}.`,
        );
      if (!personalAssistant && ACCOUNT_OWNER_SURFACES.has(surface))
        throw new Error(
          `The '${surface}' screen is the user's own to open, not yours to hand over. Say what you need and why in your reply and let them decide. Screens you may hand over: ${surfaceList}.`,
        );
      if (!personalAssistant && AGENT_SURFACES.has(surface))
        throw new Error(
          `The '${surface}' screen belongs to one AI Employee, and only the user's AI Manager can look up which. Point them to their AI Manager in your reply. Screens you may hand over: ${surfaceList}.`,
        );
      if (!apiServed && AGENT_SURFACES.has(surface))
        throw new Error(
          `This app does not offer the Houston API, so there is no '${surface}' screen to hand over. Screens you may hand over: ${surfaceList}.`,
        );
      const agentId = AGENT_SURFACES.has(surface)
        ? params.agent?.trim()
        : undefined;
      if (AGENT_SURFACES.has(surface) && !agentId)
        throw new Error(
          `The '${surface}' screen belongs to one AI Employee: pass that employee's id from listAgents as agent. Ask the user which employee they mean if you cannot tell.`,
        );
      const reason = params.reason?.trim();
      recordHandsOn({
        surface,
        ...(agentId ? { agentId } : {}),
        ...(reason ? { reason } : {}),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: "A card that opens that screen was queued. End your turn after any independent work; you get a message once the user says they finished there, or that they skipped it.",
          },
        ],
        details: { surface, ...(agentId ? { agentId } : {}) },
      };
    },
  });
}
