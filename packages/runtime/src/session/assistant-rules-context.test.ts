import { ASSISTANT_CAPABILITY_INDEX } from "@houston/domain/assistant-capability-index";
import { expect, test } from "vitest";
import {
  buildAssistantRulesSection,
  RULES_HEADING,
} from "./assistant-rules-context";

/**
 * The assistant's always-on context: the map of what it can do, then the loop
 * it runs every request through. Both are load-bearing for the same reason the
 * gates inside `houston_call` are: the model has real, destructive reach, and
 * these lines are what keep it from deleting something in order to edit it,
 * routing around a confirmation, or telling a user something is impossible
 * without having looked.
 */

const forAssistant = (): string =>
  buildAssistantRulesSection("coordinator") ?? "";

test("the context follows the ROLE the host gave this runtime, not its directory", () => {
  // The managed assistant pod runs under `/workspace` with an ordinarily-named
  // agent: a directory-shaped gate leaves that pod holding the coordinator's
  // Houston-wide toolset with none of these rails on it.
  expect(forAssistant()).toContain(RULES_HEADING);
  expect(buildAssistantRulesSection(null)).toBeNull();
});

test("the capability map is carried in front of the rules", () => {
  // The incident: asked to delete a mission, Houston answered that missions
  // cannot be deleted while `deleteActivity` sat in the catalog, visible. The
  // map is what removes "I did not know it existed" from the loop, and the
  // rules refer to it as the thing above them.
  const section = forAssistant();
  expect(section).toContain(ASSISTANT_CAPABILITY_INDEX);
  expect(section).toContain("deleteActivity");
  expect(section.indexOf(ASSISTANT_CAPABILITY_INDEX)).toBeLessThan(
    section.indexOf(RULES_HEADING),
  );
  expect(section).toContain("look in the map above");
});

test("nothing may be called impossible before the search comes back empty", () => {
  const section = forAssistant();
  expect(section).toContain("search houston_capabilities");
  expect(section).toContain(
    "NEVER tell them something cannot be done until that search comes back empty",
  );
  expect(section).toContain("say plainly that you cannot do that yet");
});

test("the user never hears what happens behind the scenes", () => {
  const section = forAssistant();
  expect(section).toContain("not technical");
  expect(section).toMatch(/no operation names, no identifiers, no tool/);
});

test("the loop covers every behaviour the incidents turned up", () => {
  const section = forAssistant();
  // Destructive work waits for the user, and a refusal is never routed around.
  expect(section).toContain("wait for their answer");
  expect(section).toContain("never work around one with a different operation");
  expect(section).toContain("ask which one they mean");
  // Values are read, never guessed: the colour incident and the provider one.
  expect(section).toContain("houston_describe");
  expect(section).toContain("listAgents");
  expect(section).toContain("listAgentProviders");
  expect(section).toContain("palette");
  expect(section).toContain(
    "A value you have not read is a value you are guessing",
  );
  expect(section).toContain("NEVER delete and recreate");
  expect(section).toContain("never guess a second format");
  // The report is honest about what actually happened.
  expect(section).toContain("Report what actually happened");
  expect(section).toContain(
    "Never describe a change you did not manage to make",
  );
});

test("a named model or provider is pinned, never quietly defaulted", () => {
  const section = forAssistant();
  // The incident: asked for "Luna" / "Sonnet", it sent the provider alone and
  // every mission ran on that provider's default model instead.
  expect(section).toContain("names a model or provider");
  expect(section).toContain("pin it exactly");
  expect(section).toMatch(/ask.*never start the mission on a default/i);
});

test("the rules pin who Houston is and where its work runs", () => {
  const section = forAssistant();
  // Identity: the incident had Houston telling the user the chat ran "under
  // the Dobby agent" while the work sat on its own hidden board.
  expect(section).toContain(
    "You are Houston, the user's AI Manager: mission control for their team of AI Employees",
  );
  expect(section).toContain("Introduce yourself as Houston");
  expect(section).toContain("never about Houston in the third person");
  // The manager IS Houston, so the rules never name the app "Houston" as a
  // separate actor it could then speak about in the third person.
  const rules = section.split(RULES_HEADING)[1] ?? "";
  expect(rules).not.toMatch(/Houston (can|cannot)\b|THIS Houston/);
  expect(section).toContain("no board of your own");
  expect(section).toContain("never claim work ran somewhere it did not");
  // Dispatcher: work belongs to an agent the user can see, named out loud.
  expect(section).toContain("Work itself is never yours");
  expect(section).toContain("propose creating one");
  expect(section).toContain("tell the user where it lives");
});

test("the rules stay short and leak no internals beyond tool names", () => {
  // Read with the API served: that is the longest the rules ever get.
  const rules =
    (buildAssistantRulesSection("coordinator", {}) ?? "").split(
      RULES_HEADING,
    )[1] ?? "";
  expect(rules.split("\n").length).toBeLessThanOrEqual(20);
  for (const banned of [".houston", ".assistant", "JSON", "HTTP", "schema"]) {
    expect(rules).not.toContain(banned);
  }
});

test("coordinator owns secure integration and provider setup", () => {
  const rules = buildAssistantRulesSection("coordinator") ?? "";
  for (const tool of [
    "request_connection",
    "request_credential",
    "request_provider_connection",
  ])
    expect(rules).toContain(tool);
  expect(rules).toContain("never delegate connection setup to an agent");
  expect(rules).toContain("Never collect credentials or sign-in codes in chat");
});

test("work that needs the person's own hands is handed over, never narrated", () => {
  // Billing, a key Houston reveals once, files on their device: the model
  // cannot do any of it, and talking a non-technical person through the clicks
  // is the failure this card replaces.
  const rules = buildAssistantRulesSection("coordinator") ?? "";
  expect(rules).toContain("request_hands_on");
  expect(rules).toContain("needs the person's own hands");
  expect(rules).toContain("never describe the steps in chat");
  // Every one of the four cards, not just the hands-on one: the operations
  // behind all of them are hidden, so a card is the ONLY route the errand has.
  expect(rules).toContain("the only route any of that takes");
  expect(rules).toContain("the steps never belong in chat");
});

test("the capability list is read as this deployment's own, not Houston's in general", () => {
  // A desktop serves part of the surface, and the map is narrowed to it. The
  // model must read a missing operation as "not here", never as "search again"
  // or "promise it anyway because Houston is known to do this".
  const rules = buildAssistantRulesSection("coordinator") ?? "";
  expect(rules).toContain(
    "houston_capabilities lists only what THIS app can do",
  );
  expect(rules).toContain(
    "anything it does not return is something this app cannot do",
  );
});

const SERVED = {};
const DESKTOP = {
  HOUSTON_ASSISTANT_UNSERVED: "listApiKeys,createApiKey,revokeApiKey",
};
const rulesOn = (env: NodeJS.ProcessEnv): string =>
  (buildAssistantRulesSection("coordinator", env) ?? "").split(
    RULES_HEADING,
  )[1] ?? "";

test("connecting an employee to the person's own code goes through its API access screen", () => {
  // The Houston API is how a person's code, automation or other AI assistant
  // starts work with an employee. The manager explains it, then lands them on
  // THAT employee's screen (IDs + a ready prompt), resolved from the roster.
  const rules = rulesOn(SERVED);
  expect(rules).toContain("through the Houston API");
  expect(rules).toContain("another AI agent or assistant");
  // A key first unless they have one: the screen's prompt reads the key from
  // their environment, so it is useless without one.
  expect(rules).toContain(
    "unless they say they already have an API key, call request_hands_on with apiKeys first, then with agentApiAccess and that employee's id from listAgents as agent",
  );
  // Its screen is drawn for the employee's managers alone.
  expect(rules).toContain(
    "when listAgents gives their access to that employee as anything but manager, tell them to ask that employee's manager instead",
  );
  expect(rules).toContain("https://gethouston.ai/developers");
  // A key is a secret: it never passes through a chat turn in either direction.
  expect(rules).toContain(
    "Never create, show, ask for or relay an API key in chat",
  );
});

test("the API is the one named exception to keeping things non-technical", () => {
  // The non-technical rule bans identifiers; explaining headers and protocols
  // to a developer who asks would contradict it unless the rules reconcile the
  // two out loud, and the IDs themselves still never come from the manager.
  const rules = rulesOn(SERVED);
  expect(rules).toContain(
    "This is the one exception to keeping things non-technical",
  );
  expect(rules).toContain("when a technical person asks how the API works");
  for (const concept of [
    "Authorization header",
    "x-houston-org",
    "REST",
    "MCP",
    "A2A",
  ])
    expect(rules).toContain(concept);
  expect(rules).toContain("the IDs still come from the screen, never from you");
});

test("a deployment without the API never hears of it", () => {
  // A desktop host stamps the API-key operations unserved: pitching the API
  // there would queue cards for a screen that does not exist.
  const rules = rulesOn(DESKTOP);
  expect(rules).not.toContain("Houston API");
  expect(rules).not.toContain("agentApiAccess");
  expect(rules).not.toContain("x-houston-org");
  // The rest of the rules stand untouched.
  expect(rules).toContain("not technical");
  expect(rules).toContain("request_hands_on");
  // An unrelated unserved operation leaves the API in.
  expect(rulesOn({ HOUSTON_ASSISTANT_UNSERVED: "createOrg" })).toContain(
    "agentApiAccess",
  );
});

test("no other company's product is named to the person", () => {
  for (const env of [SERVED, DESKTOP])
    for (const name of ["Claude Code", "Cursor", "ChatGPT", "Codex"])
      expect(rulesOn(env)).not.toContain(name);
});
