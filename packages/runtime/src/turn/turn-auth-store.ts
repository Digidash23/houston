import { join } from "node:path";
import { readAuthFile, writeAuthFile } from "../auth/auth-file";

/**
 * The `get`/`remove` slice of the credential store `readAnthropicToken` needs,
 * over this pooled turn's own `auth.json`.
 *
 * Read fresh from disk per call rather than cached: the pod's credential is
 * re-served between turns, and a cached copy would spawn the SDK on a token the
 * control plane has already replaced. `remove` is the write side of the same
 * contract — when the shared login dir proves the stored entry belongs to a
 * login the user has replaced, the dead entry is dropped instead of being
 * skipped on every future read.
 */
export function turnAuthStore(dataDir: string): {
  get: (provider: string) => ReturnType<typeof readAuthFile>[string];
  remove: (provider: string) => void;
} {
  const path = join(dataDir, "auth.json");
  return {
    get: (provider) => readAuthFile(path)[provider],
    remove: (provider) => {
      const creds = readAuthFile(path);
      if (!(provider in creds)) return;
      delete creds[provider];
      writeAuthFile(path, creds);
    },
  };
}
