import { expect, test } from "vitest";
import { parseTurnCredential } from "./parse-turn-credential";

const base = {
  provider: "anthropic",
  kind: "oauth",
  access: "sk-ant-oat01-x",
  expires: 1234,
  accountId: null,
};

test("a served Claude plan rides the parsed credential", () => {
  expect(
    parseTurnCredential({ ...base, subscriptionType: "max" }),
  ).toMatchObject({ subscriptionType: "max" });
});

test("an unknown or malformed plan is dropped, never a rejected turn", () => {
  for (const subscriptionType of ["ultra", 5, "", null]) {
    const parsed = parseTurnCredential({ ...base, subscriptionType });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("subscriptionType");
  }
});

test("absent means not connected; a broken credential is rejected", () => {
  expect(parseTurnCredential(undefined)).toBeNull();
  expect(parseTurnCredential(null)).toBeNull();
  expect(() => parseTurnCredential({ ...base, access: 7 })).toThrow(
    "invalid 'credential'",
  );
});
