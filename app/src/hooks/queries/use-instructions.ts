import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { optimisticWrite } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { serialQueue } from "../../lib/serial-queue";
import { tauriAgent } from "../../lib/tauri";

/** Writes queue per agent: each one sends the WHOLE file, so a row pick and a
 *  prose blur sent together must land in the order made, or the older file
 *  would win on the host while the newer one is painted. */
const queued = serialQueue();

/** One agent's instructions (its CLAUDE.md). Shared so every reader of an
 *  agent's job description hits the same cache entry and invalidation. A
 *  missing file reads as `""`; any other failure is a query error, already
 *  reported by the engine-call layer (`lib/tauri.ts`). */
export function instructionsQueryOptions(agentPath: string | undefined) {
  return {
    queryKey: queryKeys.instructions(agentPath ?? ""),
    queryFn: () => {
      if (!agentPath) throw new Error("agentPath required");
      return tauriAgent.readFile(agentPath, "CLAUDE.md");
    },
    enabled: !!agentPath,
    staleTime: 30_000,
  };
}

export function useInstructions(agentPath: string | undefined) {
  return useQuery(instructionsQueryOptions(agentPath));
}

/**
 * Write the agent's whole CLAUDE.md, optimistic: the cached file becomes
 * `content` at once, so the job-description rows and the prose box compose
 * their NEXT write over this one rather than over the file as it stood before
 * the host answered (which silently undid the earlier edit). A refused write
 * puts the old file back with an authored toast (`optimisticWrite`).
 *
 * Resolves `true` once the host has the file and `false` when it refused, and
 * never rejects: the failure is already toasted and reported.
 */
export function useSaveInstructions(agentPath: string | undefined) {
  const qc = useQueryClient();
  const { t } = useTranslation("agents");
  return (content: string): Promise<boolean> => {
    if (!agentPath) return Promise.resolve(false);
    let saved = false;
    return optimisticWrite({
      qc,
      command: "save_instructions",
      patches: [
        { queryKey: queryKeys.instructions(agentPath), apply: () => content },
      ],
      write: () =>
        queued(agentPath, async () =>
          tauriAgent.writeFile(agentPath, "CLAUDE.md", content),
        ),
      failure: {
        title: t("instructions.saveErrorTitle"),
        description: t("instructions.saveErrorBody"),
      },
      onSuccess: () => {
        saved = true;
      },
    }).then(() => saved);
  };
}
