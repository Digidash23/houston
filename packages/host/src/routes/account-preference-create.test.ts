import { afterAll, beforeAll, expect, test } from "vitest";
import { auth, startAccountServer } from "../../tests/account-fixture";

let base = "";
let close: () => Promise<void>;
beforeAll(async () => {
  ({ base, close } = await startAccountServer());
});
afterAll(async () => close());

const put = (user: string, value: string | null, createOnly: boolean) =>
  fetch(`${base}/v1/preferences/timezone`, {
    method: "PUT",
    headers: auth(user),
    body: JSON.stringify(
      createOnly ? { value, onlyIfAbsent: true } : { value },
    ),
  });

test("a create-only write lands when nothing is stored", async () => {
  const r = await put("carol", "America/Bogota", true);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ value: "America/Bogota" });
});

test("a create-only write never overwrites: 412 with the stored value", async () => {
  await put("dave", "Europe/Lisbon", false);
  const r = await put("dave", "America/Bogota", true);
  expect(r.status).toBe(412);
  expect(await r.json()).toEqual({
    code: "preference_exists",
    value: "Europe/Lisbon",
  });
  const get = await fetch(`${base}/v1/preferences/timezone`, {
    headers: auth("dave"),
  });
  expect(await get.json()).toEqual({ value: "Europe/Lisbon" });
});

test("a blank stored value counts as unset; a plain PUT still overwrites", async () => {
  await put("erin", "  ", false);
  expect((await put("erin", "Asia/Tokyo", true)).status).toBe(200);
  expect((await put("erin", "Europe/Madrid", false)).status).toBe(200);
});

test("a create-only null never clears a stored value", async () => {
  await put("frank", "Europe/Lisbon", false);
  const r = await put("frank", null, true);
  expect(r.status).toBe(412);
  expect(await r.json()).toEqual({
    code: "preference_exists",
    value: "Europe/Lisbon",
  });
});

test("concurrent create-only writes: exactly one lands", async () => {
  const answers = await Promise.all(
    ["Asia/Tokyo", "America/Bogota", "Europe/Madrid"].map((tz) =>
      put("gina", tz, true),
    ),
  );
  expect(answers.map((r) => r.status).sort()).toEqual([200, 412, 412]);
});
