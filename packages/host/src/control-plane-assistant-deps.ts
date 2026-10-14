import type { AssistantDeps } from "./routes/assistant";
import type { AssistantSandboxDeps } from "./routes/assistant-sandbox-deps";
import type { HeartbeatRouteDeps } from "./routes/heartbeat";

/** Deployment-specific operations available to the AI Manager. */
export interface ControlPlaneAssistantDeps {
  /** Materialize the personal assistant's home on local filesystem profiles. */
  ensureSyntheticAgentDir?: AssistantDeps["ensureSyntheticAgentDir"];
  /**
   * The AI Manager's morning-briefing runner (heartbeat/runner.ts), behind
   * `POST /v1/heartbeat/run`. Wired by the local / self-host profile only;
   * absent → that route answers 501.
   */
  heartbeat?: HeartbeatRouteDeps["heartbeat"];
  /** Resolve user-facing operations through the gateway or this host. */
  assistantGateway?: AssistantSandboxDeps["assistantGateway"];
  /** Operations this deployment cannot perform. */
  unservedOperations?: AssistantSandboxDeps["unservedOperations"];
}
