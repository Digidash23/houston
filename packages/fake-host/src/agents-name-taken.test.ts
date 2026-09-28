import { afterEach, beforeEach, expect, it } from "vitest";
import { type FakeHost, startFakeHost } from "./server";

/**
 * The fake host refuses another agent's name the way the real host does
 * (packages/host/src/routes/agent-name-taken.ts): 409 `name_taken`, compared
 * trimmed and case-insensitively, for a create and for a rename, while a new
 * spelling of an agent's own name stays a rename.
 */

const JSON_HEADERS = { "content-type": "application/json" };
let host: FakeHost;

beforeEach(async () => {
  host = await startFakeHost(0);
});
afterEach(async () => {
  await host.stop();
});

const send = (method: string, path: string, body: unknown) =>
  fetch(`${host.url}${path}`, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

it("refuses a create or rename onto another agent's name, in any case", async () => {
  const mia = (await (
    await send("POST", "/agents", { name: "Mia" })
  ).json()) as {
    id: string;
  };
  const leo = (await (
    await send("POST", "/agents", { name: "Leo" })
  ).json()) as {
    id: string;
  };

  const create = await send("POST", "/agents", { name: " mia " });
  expect(create.status).toBe(409);
  expect(await create.json()).toMatchObject({ code: "name_taken" });

  const rename = await send("PATCH", `/agents/${leo.id}`, { name: "MIA" });
  expect(rename.status).toBe(409);
  expect(await rename.json()).toMatchObject({ code: "name_taken" });

  const ownSpelling = await send("PATCH", `/agents/${mia.id}`, { name: "MIA" });
  expect(ownSpelling.status).toBe(200);
});

it("stores a created or renamed name trimmed, like the real host", async () => {
  const created = await send("POST", "/agents", { name: "  Orion  " });
  const orion = (await created.json()) as { id: string; name: string };
  expect(orion.name).toBe("Orion");

  const renamed = await send("PATCH", `/agents/${orion.id}`, {
    name: " Vega ",
  });
  expect(await renamed.json()).toMatchObject({ name: "Vega" });
});

it("answers 404 for an unknown agent before checking the name", async () => {
  await send("POST", "/agents", { name: "Mia" });

  const rename = await send("PATCH", "/agents/agent-missing", { name: "Mia" });
  expect(rename.status).toBe(404);
});
