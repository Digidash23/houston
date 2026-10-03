/**
 * The shell's "sign in again soon" notice, read off the probed provider
 * statuses. The rule (which deadline, how many days ahead) is the SDK's
 * `providerReconnectNotices`; this only hands it the app's status shape.
 */

import {
  type ProviderReconnectNotice,
  providerReconnectNotices,
} from "@houston/sdk";
import type { ProviderStatus } from "./tauri";

/** The soonest due notice among `statuses`, or null. */
export function providerReconnectNoticeFor(
  statuses: Record<string, ProviderStatus>,
  now: number,
): ProviderReconnectNotice | null {
  const due = providerReconnectNotices(
    Object.values(statuses).map((status) => ({
      provider: status.provider,
      connected: status.authenticated,
      reconnectBy: status.reconnectBy,
    })),
    now,
  );
  return due[0] ?? null;
}
