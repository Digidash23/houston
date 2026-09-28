import { expect, test } from "vitest";
import { actingSubFromHeader, actingViaFromHeader } from "./acting";

const payload = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

test("decodes the sub from a well-formed acting-as header", () => {
  const token = `acting-v1.${payload({ sub: "user-123", agent: "a1", exp: 1 })}.sig`;
  expect(actingSubFromHeader(token)).toBe("user-123");
});

test("takes the first value of a repeated header", () => {
  const token = `acting-v1.${payload({ sub: "first" })}.sig`;
  expect(actingSubFromHeader([token, "acting-v1.other.sig"])).toBe("first");
});

test("anything malformed reads as no acting identity, never a throw", () => {
  expect(actingSubFromHeader(undefined)).toBeUndefined();
  expect(actingSubFromHeader("")).toBeUndefined();
  expect(actingSubFromHeader("acting-v1.onlytwo")).toBeUndefined();
  expect(actingSubFromHeader("wrong-prefix.abc.sig")).toBeUndefined();
  expect(actingSubFromHeader("acting-v1.!!!not-base64url!!!.sig")).toBe(
    undefined,
  );
  expect(
    actingSubFromHeader(
      `acting-v1.${Buffer.from("not json").toString("base64url")}.sig`,
    ),
  ).toBeUndefined();
  expect(
    actingSubFromHeader(`acting-v1.${payload({ agent: "a1" })}.sig`),
  ).toBeUndefined();
  expect(
    actingSubFromHeader(`acting-v1.${payload({ sub: "" })}.sig`),
  ).toBeUndefined();
  expect(
    actingSubFromHeader(`acting-v1.${payload({ sub: 42 })}.sig`),
  ).toBeUndefined();
});

test("reads the gateway's via claim only beside a sub", () => {
  const via = (claims: unknown) =>
    actingViaFromHeader(`acting-v1.${payload(claims)}.sig`);
  expect(via({ sub: "u1", via: "assistant" })).toBe("assistant");
  expect(via({ sub: "u1" })).toBeUndefined();
  expect(via({ via: "assistant" })).toBeUndefined();
  expect(via({ sub: "", via: "assistant" })).toBeUndefined();
  expect(via({ sub: "u1", via: "" })).toBeUndefined();
  expect(via({ sub: "u1", via: 1 })).toBeUndefined();
  expect(actingViaFromHeader(undefined)).toBeUndefined();
  expect(actingViaFromHeader("garbage")).toBeUndefined();
});
