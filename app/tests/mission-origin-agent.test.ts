import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { missionOriginAgentName } from "../src/lib/mission-card-agent";
import type { Agent } from "../src/lib/types";

const agents = [
  { id: "writer", folderPath: "Personal/Writer", name: "Marisol" },
  { id: "scout", folderPath: "Personal/Scout", name: "Kai" },
] as Agent[];

describe("missionOriginAgentName", () => {
  it("resolves the starting agent by id or folder path", () => {
    strictEqual(missionOriginAgentName(agents, "writer"), "Marisol");
    strictEqual(missionOriginAgentName(agents, "Personal/Scout"), "Kai");
  });

  it("leaves unknown or absent starters for the generic label", () => {
    const generic = "Started by AI Employee";
    strictEqual(missionOriginAgentName(agents, "deleted") ?? generic, generic);
    strictEqual(missionOriginAgentName(agents, undefined) ?? generic, generic);
  });
});
