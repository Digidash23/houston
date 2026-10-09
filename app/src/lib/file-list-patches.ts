/**
 * Pure edits of an agent's file listing (`queryKeys.files`), painted before
 * the host answers a delete / rename / move / new folder. Each tolerates a
 * listing that never loaded and is idempotent: it is re-run over every
 * refetch that lands while its write is in flight, so a listing that already
 * reflects the change comes back unchanged (the same array).
 *
 * The host's listing is flat and recursive (`files-list.ts`): a folder row
 * plus a row for everything beneath it, so a folder edit carries its
 * descendants with it.
 */
import type { FileEntry } from "@houston-ai/agent";

const isUnder = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

const lastSegment = (path: string) => path.split("/").pop() ?? path;

/** Same rule as the host's `extOf`: a leading dot is a name, not a type. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

/** The listing without `paths` and everything nested under them. */
export function withoutFileEntries(
  files: FileEntry[] | undefined,
  paths: readonly string[],
): FileEntry[] | undefined {
  if (!files) return files;
  const next = files.filter((f) => !paths.some((p) => isUnder(f.path, p)));
  return next.length === files.length ? files : next;
}

/** Re-home `from` (and its descendants) at `to`. */
export function relocateFileEntry(
  files: FileEntry[] | undefined,
  from: string,
  to: string,
): FileEntry[] | undefined {
  if (!files || from === to || !files.some((f) => f.path === from)) {
    return files;
  }
  return files.map((f) => {
    if (!isUnder(f.path, from)) return f;
    const path = `${to}${f.path.slice(from.length)}`;
    if (f.path !== from) return { ...f, path };
    const name = lastSegment(to);
    return {
      ...f,
      path,
      name,
      extension: f.is_directory ? "" : extensionOf(name),
    };
  });
}

/**
 * Move `from` onto `occupant`'s place, dropping the occupant. A listing whose
 * `from` is already gone has had the move applied: left untouched, so the
 * moved entry (now AT the occupant's path) is never dropped as the occupant.
 */
export function replaceFileEntry(
  files: FileEntry[] | undefined,
  from: string,
  occupant: string,
): FileEntry[] | undefined {
  if (!files?.some((f) => f.path === from)) return files;
  return relocateFileEntry(
    withoutFileEntries(files, [occupant]),
    from,
    occupant,
  );
}

/** Where a rename of `path` to `newName` lands: same folder, new name. */
export function renamedPath(path: string, newName: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? newName : `${path.slice(0, slash)}/${newName}`;
}

/** The listing with an empty folder at `path`, unless one is already there. */
export function withFolderEntry(
  files: FileEntry[] | undefined,
  path: string,
  now: number,
): FileEntry[] | undefined {
  if (!files || files.some((f) => f.path === path)) return files;
  const folder: FileEntry = {
    path,
    name: lastSegment(path),
    extension: "",
    size: 0,
    is_directory: true,
    dateModified: now,
    dateCreated: now,
  };
  return [folder, ...files];
}
