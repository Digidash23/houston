/**
 * Rename-with-conflict flow for the Files section: a rename onto a name a
 * sibling already carries is answered from the listing the UI already has,
 * with authored copy, instead of being sent to the host only to come back as a
 * 409. The write keeps its own 409 surface for the race (another writer takes
 * the name between the listing and the request): the optimistic rename rolls
 * back with the same sentence. This is the instant answer for the case the
 * listing can already see.
 */
import type { FileEntry } from "@houston-ai/agent";
import { useCallback } from "react";
import { detectRenameConflict } from "../lib/file-conflicts";
import { showNameTakenToast } from "../lib/name-taken-toast";
import { useFileWrites } from "./queries";

export function useRenameWithConflict(
  agentPath: string | undefined,
  files: readonly FileEntry[] | undefined,
): (sourcePath: string, newName: string) => void {
  const writes = useFileWrites(agentPath);
  return useCallback(
    (sourcePath: string, newName: string) => {
      const conflict = detectRenameConflict(files ?? [], sourcePath, newName);
      if (conflict.kind === "noop") return;
      if (conflict.kind === "conflict") {
        showNameTakenToast(conflict.name);
        return;
      }
      void writes.rename(sourcePath, newName);
    },
    [files, writes],
  );
}
