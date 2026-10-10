import { type FirstDayStartInput, parseTurnLimits } from "@houston/protocol";
import { routineActorFor } from "../auth/acting";
import { channelFor, DEFAULT_PATHS, noChannel } from "./agent-authz";
import { startFirstDay } from "./agent-first-day-start";
import { json, readJson } from "./http";
import { defineRoute } from "./registry";

/** The longest locale tag or title a start accepts: both are one short label. */
const MAX_FIELD_LENGTH = 200;

type Parsed =
  | { ok: true; input: FirstDayStartInput }
  | { ok: false; error: string };

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) return null;
  return value;
}

export function parseFirstDayStart(body: Record<string, unknown>): Parsed {
  const locale = optionalText(body.locale);
  const title = optionalText(body.title);
  if (locale === null || title === null)
    return {
      ok: false,
      error: `'locale' and 'title' are optional strings of at most ${MAX_FIELD_LENGTH} characters`,
    };
  return {
    ok: true,
    input: {
      ...(locale ? { locale } : {}),
      ...(title ? { title } : {}),
    },
  };
}

/**
 * `POST /agents/:agentId/first-day` — start the employee's first day, or hand
 * back the setup task that already started it (`agent-first-day-start.ts`).
 * The pool worker also shares its input parser and task builder; the gateway
 * completes that start with claimed board and config writes.
 */
defineRoute({
  group: "agent-first-day",
  method: "POST",
  path: "/agents/:agentId/first-day",
  phase: "agent",
  classification: "sdk",
  source: "packages/host/src/routes/agent-first-day.ts",
  async handler({
    deps,
    authz,
    actingAs,
    actingAuthor,
    userId,
    emit,
    req,
    res,
  }) {
    const body = await readJson(req);
    const parsed = parseFirstDayStart(body);
    if (!parsed.ok) return json(res, 400, { error: parsed.error });
    if (!deps.vfs)
      return json(res, 503, { error: "agent data not configured" });
    const channel = channelFor(deps, authz.workspace);
    if (!channel) return noChannel(res, authz.workspace.runtime);
    const answer = await startFirstDay(
      {
        vfs: deps.vfs,
        root: (deps.paths ?? DEFAULT_PATHS).agentRoot(
          authz.workspace,
          authz.agent,
        ),
        workspace: authz.workspace,
        agent: authz.agent,
        channel,
        author: actingAuthor ?? undefined,
        // The same acting policy a routine fire follows (auth/acting.ts).
        actingUser: routineActorFor(deps, req, userId),
        actingAs,
        // The gateway's plan stamp, trusted only behind it: the first turn's
        // routine saves are held to the person's floor.
        limits: deps.gatewayFronted ? parseTurnLimits(body.limits) : undefined,
        emit,
      },
      parsed.input,
    );
    if (!answer.ok) {
      const { ok: _ok, status, ...refusal } = answer;
      return json(res, status, refusal);
    }
    json(res, answer.status, answer.result);
  },
});
