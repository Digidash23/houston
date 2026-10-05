import { mkdirSync } from "node:fs";
import { claudeLoginConfigDir } from "../backends/claude/paths";
import {
  anthropicServedHere,
  serveModeOn,
  syncServedCredentialSafe,
} from "./serve";
/**
 * Where the anthropic CLI login must leave its credential (PRODUCT-1644).
 *
 * On a host that never serves anthropic back — the desktop and self-host
 * hosts answer the serve probe with the not-served-here marker — the SHARED
 * login dir every agent runtime probes is the single holder, the way the
 * desktop's own browser login leaves it. The throwaway-dir path would store
 * the credential in this runtime's auth.json, capture would move it to a
 * central row nothing serves and scrub the local refresh token, and the
 * connect would read connected for one poll and then disconnected for good.
 *
 * A gateway-fronted pod keeps the throwaway dir: its shared dir is the TEAM's
 * credential (HOU-976), so a member's login must never land there, and the
 * capture chain stores it centrally. Outside serve mode (a standalone
 * runtime) nothing captures, so auth.json keeps holding it as before. An
 * unanswered probe is asked once here rather than guessed.
 */
export async function anthropicSharedLoginDir(): Promise<string | null> {
  if (!serveModeOn()) return null;
  if (anthropicServedHere() === undefined)
    await syncServedCredentialSafe("anthropic-login");
  if (anthropicServedHere() !== false) return null;
  const dir = claudeLoginConfigDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
