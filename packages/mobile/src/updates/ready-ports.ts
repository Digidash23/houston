import { CapacitorUpdater } from "@capgo/capacitor-updater";
import type { ReadyPorts } from "./ready";

export function capgoReadyPorts(report: (error: unknown) => void): ReadyPorts {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing mobile root");
  return {
    root,
    notifyAppReady: () => CapacitorUpdater.notifyAppReady(),
    currentBundle: async () => (await CapacitorUpdater.current()).bundle,
    resetToBuiltin: () => CapacitorUpdater.reset(),
    storage: localStorage,
    report,
  };
}
