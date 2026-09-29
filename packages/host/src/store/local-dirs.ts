import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PREFERENCES_NAMESPACE } from "@houston/domain";

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The dot-less subdirectories of `p`, sorted. Dot-dirs are never agents or
 *  workspaces (`.shared`, `.assistant`, `.setup`). */
export function listDirs(p: string): string[] {
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((name) => !name.startsWith(".") && isDir(join(p, name)))
    .sort();
}

/** A folder under the workspaces root that can hold agents. The preferences
 *  namespace sits beside the workspaces (see `PREFERENCES_NAMESPACE`) and
 *  only ever holds `<workspaceId>/preferences.json`. */
export const isWorkspaceDirName = (name: string) =>
  name !== PREFERENCES_NAMESPACE;

/** The workspace folders under the workspaces root. */
export function listWorkspaceDirs(root: string): string[] {
  return listDirs(root).filter(isWorkspaceDirName);
}

/** Every agent dir under the tree: `<root>/<Workspace>/<Agent>`. */
export function listAgentDirs(root: string): string[] {
  return listWorkspaceDirs(root).flatMap((ws) =>
    listDirs(join(root, ws)).map((agent) => join(root, ws, agent)),
  );
}
