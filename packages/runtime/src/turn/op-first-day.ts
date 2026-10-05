import {
  buildFirstDayPrompt,
  firstDayBrief,
  loadConfig,
} from "@houston/domain";
import { parseFirstDayStart } from "@houston/host/src/routes/agent-first-day";
import { newSetupTask } from "@houston/host/src/routes/agent-first-day-turn";
import { encodeAutoContinue } from "@houston/protocol";
import type { OpResult } from "./op-apply";
import type { OpRequest } from "./parse-op-request";
import type { TurnFilesystem } from "./turn-filesystem";

/** Prepare only. The gateway writes the board and starts the claimed turn. */
export async function prepareFirstDayOp(
  op: OpRequest,
  fs: TurnFilesystem,
): Promise<OpResult> {
  if (op.op.kind !== "first-day") throw new Error("not a first-day op");
  const parsed = parseFirstDayStart(JSON.parse(op.op.body || "{}"));
  const json = (status: number, body: unknown): OpResult => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    events: [],
    include: () => false,
  });
  if (!parsed.ok) return json(400, { error: parsed.error });
  const { config } = await loadConfig(fs.vfs, fs.workspaceRel);
  const brief = firstDayBrief(
    await fs.vfs.readText(`${fs.workspaceRel}/CLAUDE.md`),
  );
  const name = op.agentName ?? fs.workspaceRel.split("/").at(-1) ?? "Agent";
  return json(200, {
    config,
    role: brief?.role ?? null,
    task: newSetupTask(
      {
        author: op.actingAs
          ? {
              user_id: op.actingAs.userId,
              ...(op.actingAs.name ? { name: op.actingAs.name } : {}),
            }
          : undefined,
      },
      parsed.input,
      config,
    ),
    text: encodeAutoContinue(
      buildFirstDayPrompt(name, parsed.input.locale ?? "en", brief),
    ),
  });
}
