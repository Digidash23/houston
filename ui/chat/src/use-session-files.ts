import { useCallback, useRef, useState } from "react";

export interface SessionFiles {
  files: File[];
  setFiles: (files: File[]) => void;
  /** Drop exactly these File objects from whichever list still holds them,
   *  read at call time: a send that settles after the user switched
   *  conversations, or added a file meanwhile, removes only what it sent. */
  releaseFiles: (sent: readonly File[]) => void;
}

/**
 * The panel's attachment list, one per conversation. A board reuses ONE panel
 * across conversations, so an unscoped list would follow the user from one
 * conversation to the next and leave with the wrong one's message. Switching
 * parks the list under its `sessionKey` and hands it back on return.
 *
 * Controlled (`attachments` given): the parent owns the list and its scoping,
 * and this only forwards.
 */
export function useSessionFiles(
  sessionKey: string,
  attachments: File[] | undefined,
  onAttachmentsChange: ((files: File[]) => void) | undefined,
): SessionFiles {
  const [byKey, setByKey] = useState<Record<string, File[]>>({});
  const controlled = attachments !== undefined;
  const latestControlled = useRef(attachments);
  latestControlled.current = attachments;

  const files = controlled ? attachments : (byKey[sessionKey] ?? NONE);
  const setFiles = useCallback(
    (next: File[]) => {
      if (controlled) onAttachmentsChange?.(next);
      else setByKey((prev) => withList(prev, sessionKey, next));
    },
    [controlled, onAttachmentsChange, sessionKey],
  );
  const releaseFiles = useCallback(
    (sent: readonly File[]) => {
      if (sent.length === 0) return;
      const keep = (f: File) => !sent.includes(f);
      if (controlled) {
        const current = latestControlled.current ?? [];
        if (current.some((f) => !keep(f)))
          onAttachmentsChange?.(current.filter(keep));
        return;
      }
      setByKey((prev) => {
        let next = prev;
        for (const [key, list] of Object.entries(prev)) {
          if (list.every(keep)) continue;
          next = withList(next, key, list.filter(keep));
        }
        return next;
      });
    },
    [controlled, onAttachmentsChange],
  );
  return { files, setFiles, releaseFiles };
}

const NONE: File[] = [];

function withList(
  prev: Record<string, File[]>,
  key: string,
  list: File[],
): Record<string, File[]> {
  const next = { ...prev };
  if (list.length === 0) delete next[key];
  else next[key] = list;
  return next;
}
