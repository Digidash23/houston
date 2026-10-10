import { isAgentWarmingRefusal } from "./agent-warming-refusal.ts";
import { fileRefusal } from "./file-conflicts.ts";

/**
 * Which ONE surface a refused file write earns once its optimistic paint is
 * rolled back:
 *
 *  - `name_taken`: the race the up-front collision check cannot close. It gets
 *    the same sentence that check shows, never a generic failure on top.
 *  - `read_only`: the workspace folder refuses every write; its own copy names
 *    the remedy.
 *  - `warming`: the "almost ready" dialog is already open and IS the surface.
 *  - `failed`: anything else, told with the write's authored failure copy.
 */
export type FileWriteRefusal =
  | "name_taken"
  | "read_only"
  | "warming"
  | "failed";

export function classifyFileWriteRefusal(err: unknown): FileWriteRefusal {
  if (isAgentWarmingRefusal(err)) return "warming";
  return fileRefusal(err) ?? "failed";
}
