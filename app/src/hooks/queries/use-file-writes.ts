import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { logAndReportError } from "../../lib/error-report";
import {
  type FileListEdit,
  newFolderEdit,
  relocationEdit,
  removalEdit,
  renamedPath,
  replacementEdit,
} from "../../lib/file-list-patches";
import { classifyFileWriteRefusal } from "../../lib/file-write-refusal";
import i18n from "../../lib/i18n";
import { showNameTakenToast } from "../../lib/name-taken-toast";
import type { OptimisticFailureCopy } from "../../lib/optimistic-core";
import { runOptimisticWrite } from "../../lib/optimistic-core";
import { tellOptimisticRefusal } from "../../lib/optimistic-write";
import { queryKeys } from "../../lib/query-keys";
import { showReadOnlyToast } from "../../lib/read-only-toast";
import { tauriFiles } from "../../lib/tauri";

/**
 * An agent's file writes, painted into its listing the moment the person acts
 * and sent in the background. Every method resolves once the host answered
 * and never rejects: a refusal rolls the listing back and gets exactly one
 * surface (`classifyFileWriteRefusal`). The host's `FilesChanged` event and
 * the settle-time refetch then replace the guess with the real listing.
 */
export interface FileWrites {
  remove: (paths: readonly string[]) => Promise<void>;
  rename: (path: string, newName: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  move: (path: string, toDir: string | null) => Promise<void>;
  /** Move onto an occupied name: the occupant goes first, then the move. */
  replace: (
    occupant: string,
    path: string,
    toDir: string | null,
  ) => Promise<void>;
  /** Move under a free name: renamed in place first, then moved. */
  keepBoth: (
    path: string,
    newName: string,
    toDir: string | null,
  ) => Promise<void>;
}

const lastSegment = (path: string) => path.split("/").pop() ?? path;
const joinDir = (dir: string | null, name: string) =>
  dir ? `${dir}/${name}` : name;

const copy = (titleKey: string, vars: Record<string, unknown>) => ({
  title: i18n.t(titleKey, vars),
  description: i18n.t("agents:files.failed.description"),
});

export function useFileWrites(agentPath: string | undefined): FileWrites {
  const qc = useQueryClient();
  return useMemo(() => {
    const run = (step: {
      command: string;
      /** The entry the copy names: the name the write was aiming at. */
      name: string;
      edit: FileListEdit;
      // Async so a synchronous refusal (the warming guard throws before any
      // request) still rolls back instead of escaping past the paint.
      write: (path: string) => Promise<unknown>;
      failure: () => OptimisticFailureCopy;
    }): Promise<void> => {
      if (!agentPath) return Promise.resolve();
      return runOptimisticWrite(
        {
          qc,
          command: step.command,
          patches: [{ queryKey: queryKeys.files(agentPath), ...step.edit }],
          write: () => step.write(agentPath),
          // Resolved at refusal time instead (`step.failure`): the copy names
          // what actually failed, which a batch only knows once it settles.
          failure: { title: "", description: "" },
        },
        (command, err) => {
          switch (classifyFileWriteRefusal(err)) {
            case "name_taken":
              return showNameTakenToast(step.name);
            case "read_only":
              return showReadOnlyToast();
            case "warming":
              return;
            case "failed":
              return tellOptimisticRefusal(command, err, step.failure());
          }
        },
        logAndReportError,
      );
    };

    const remove: FileWrites["remove"] = (paths) => {
      let failed: string[] = [];
      return run({
        command: "delete_file",
        name: lastSegment(paths[0] ?? ""),
        edit: removalEdit(paths),
        // One request per entry, so one refused file never takes its siblings
        // with it; the first refusal speaks for the batch.
        write: async (root) => {
          const results = await Promise.allSettled(
            paths.map((p) => tauriFiles.delete(root, p)),
          );
          failed = paths.filter((_, i) => results[i]?.status === "rejected");
          const refused = results.find((r) => r.status === "rejected");
          if (refused) throw refused.reason;
        },
        failure: () =>
          copy("agents:files.failed.delete", {
            count: failed.length,
            name: lastSegment(failed[0] ?? ""),
          }),
      });
    };

    return {
      remove,
      rename: (path, newName) =>
        run({
          command: "rename_file",
          name: newName,
          edit: relocationEdit(path, renamedPath(path, newName)),
          write: async (root) => tauriFiles.rename(root, path, newName),
          failure: () =>
            copy("agents:files.failed.rename", { name: lastSegment(path) }),
        }),
      createFolder: (path) =>
        run({
          command: "create_agent_folder",
          name: lastSegment(path),
          edit: newFolderEdit(path, Date.now()),
          write: async (root) => tauriFiles.createFolder(root, path),
          failure: () =>
            copy("agents:files.failed.createFolder", {
              name: lastSegment(path),
            }),
        }),
      move: (path, toDir) =>
        run({
          command: "move_project_file",
          name: lastSegment(path),
          edit: relocationEdit(path, joinDir(toDir, lastSegment(path))),
          write: async (root) => tauriFiles.move(root, path, toDir),
          failure: () =>
            copy("agents:files.failed.move", { name: lastSegment(path) }),
        }),
      replace: (occupant, path, toDir) =>
        run({
          command: "move_project_file",
          name: lastSegment(path),
          edit: replacementEdit(path, occupant),
          write: async (root) => {
            await tauriFiles.delete(root, occupant);
            await tauriFiles.move(root, path, toDir);
          },
          failure: () =>
            copy("agents:files.failed.move", { name: lastSegment(path) }),
        }),
      keepBoth: (path, newName, toDir) =>
        run({
          command: "move_project_file",
          name: newName,
          edit: relocationEdit(path, joinDir(toDir, newName)),
          write: async (root) => {
            const renamed = renamedPath(path, newName);
            await tauriFiles.rename(root, path, newName);
            await tauriFiles.move(root, renamed, toDir);
          },
          failure: () =>
            copy("agents:files.failed.move", { name: lastSegment(path) }),
        }),
    };
  }, [qc, agentPath]);
}
