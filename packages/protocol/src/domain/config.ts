// Per-agent config + host-level preferences.

/** Where a new AI Employee stands on its first day (its setup task). */
export type AgentFirstDay = "pending" | "started";

/** How an AI Employee joined: hired in the app, or imported from a package. */
export type AgentArrival = "created" | "imported";

export interface AgentConfig {
  name?: string;
  provider?: string;
  model?: string;
  effort?: string;
  /**
   * `"pending"`: hired, first day not run yet; the only state that offers
   * the user the button that starts it. `"started"`: its first day started,
   * or a mission started on its board. Absent: the employee predates the field.
   * Host-owned: the first-day start or any board mission start moves it to
   * `"started"`; config writes preserve it.
   */
  firstDay?: AgentFirstDay;
  /** Recorded with a pending first day, for the analytics its start reports. */
  arrival?: AgentArrival;
  [extra: string]: unknown;
}

/**
 * The config an agent is CREATED with, written in the same request that
 * creates it: the brain it works on and, for a new hire, its pending first
 * day. A first day is never born started.
 */
export interface AgentInitialConfig {
  /** Either provider-id dialect; stored canonical. */
  provider?: string;
  model?: string;
  firstDay?: Extract<AgentFirstDay, "pending">;
  arrival?: AgentArrival;
}

/**
 * One entry of the installed agent-config library — a `houston.json` template
 * the user added (e.g. from a GitHub repo) that the create-agent picker merges
 * alongside the bundled first-party templates. `config` is the raw manifest
 * (id/name/description/claudeMd/agentSeeds/…, authored outside this repo, so
 * untyped here); `path` is the library key the entry lives under.
 */
export interface InstalledAgentConfig {
  config: Record<string, unknown>;
  path: string;
}

export interface PreferenceValue {
  value: string | null;
}

/** Well-known preference keys (free-form strings remain allowed). */
export type KnownPreferenceKey = "timezone" | "locale";
