import {
  PROBE_AGENT,
  type Probe,
  probe,
  proxied,
} from "./assistant-parity-probes";

const AGENT = { agentId: PROBE_AGENT };

export const LOCAL_INTEGRATION_PROBES: readonly Probe[] = [
  probe("integrationStatus"),
  probe("integrationToolkits", { provider: "composio" }),
  probe("integrationConnections", { provider: "composio" }),
  probe("integrationConnection", {
    provider: "composio",
    connectionId: "no-such-connection",
  }),
  probe("triggerTypes", { toolkit: "gmail" }),
  probe("customIntegrations"),
  probe("addCustomIntegration", { input: {} }),
  probe("detectCustomIntegration", { url: "not-a-url" }),
  probe("customIntegrationTools", { slug: "no-such-integration" }),
  probe("removeCustomIntegration", { slug: "no-such-integration" }),
  probe("agentCustomIntegrations", { agentSlugOrId: PROBE_AGENT }),
  probe("addAgentCustomIntegration", { agentSlugOrId: PROBE_AGENT, input: {} }),
  probe("detectAgentCustomIntegration", {
    agentSlugOrId: PROBE_AGENT,
    url: "not-a-url",
  }),
  probe("agentCustomIntegrationTools", {
    agentSlugOrId: PROBE_AGENT,
    slug: "no-such-integration",
  }),
  probe("removeAgentCustomIntegration", {
    agentSlugOrId: PROBE_AGENT,
    slug: "no-such-integration",
  }),
  probe("updateCustomIntegrationDetails", {
    slug: "no-such-integration",
    details: {},
  }),
  probe("updateAgentCustomIntegrationDetails", {
    agentSlugOrId: PROBE_AGENT,
    slug: "no-such-integration",
    details: {},
  }),
  probe("integrations.disconnect", { toolkit: "gmail" }),
  proxied(
    "providers.refreshStatus",
    AGENT,
    "GET auth/status is the engine's own route; the host relays it",
  ),
  probe("forgetCredential", { ...AGENT, provider: "openrouter" }),
];
