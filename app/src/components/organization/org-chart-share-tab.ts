import type { ReservedTab } from "../../lib/browser-tab.ts";

/**
 * The share run's tab claim, DOM-free so its wiring is testable: no tab in
 * the desktop shell (it hands URLs to the OS, which has no gesture rule),
 * else a tab claimed in the click that shows `line` (authored, translated)
 * while the upload runs. A holding line that cannot be written is reported
 * and the share goes on with the tab it claimed.
 */
export function shareTabReserver(
  line: string,
  env: {
    tauri: boolean;
    reserve: () => ReservedTab | null;
    report: (command: string, error: unknown) => void;
  },
): () => ReservedTab | null {
  return () => {
    if (env.tauri) return null;
    const tab = env.reserve();
    try {
      tab?.hold(line);
    } catch (error) {
      env.report("org_chart_share_holding", error);
    }
    return tab;
  };
}
