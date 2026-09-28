import type { IncomingMessage } from "node:http";
import { describe, expect, test } from "vitest";
import { ACTING_AS_HEADER } from "./acting";
import {
  ASSISTANT_CALL_HEADER,
  assistantCallHeaders,
  isAssistantRequest,
} from "./assistant-call";

const acting = (claims: Record<string, unknown>) =>
  `acting-v1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const request = (
  headers: Record<string, string>,
  remoteAddress = "127.0.0.1",
): IncomingMessage =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

const OFF = { gatewayFronted: false };
const ON = { gatewayFronted: true };
const VIA = { [ACTING_AS_HEADER]: acting({ sub: "u1", via: "assistant" }) };

describe("off the gateway (desktop, self-host)", () => {
  test("the dispatcher's loopback proof marks the manager", () => {
    expect(isAssistantRequest(OFF, request(assistantCallHeaders()))).toBe(true);
    expect(
      isAssistantRequest(OFF, request(assistantCallHeaders(), "::1")),
    ).toBe(true);
    expect(
      isAssistantRequest(
        OFF,
        request(assistantCallHeaders(), "::ffff:127.0.0.1"),
      ),
    ).toBe(true);
  });

  test("the proof counts only from a loopback peer", () => {
    expect(
      isAssistantRequest(OFF, request(assistantCallHeaders(), "10.0.0.7")),
    ).toBe(false);
    expect(
      isAssistantRequest(
        OFF,
        request(assistantCallHeaders(), "::ffff:192.168.1.4"),
      ),
    ).toBe(false);
  });

  test.each([
    "",
    "guess",
    `${assistantCallHeaders()[ASSISTANT_CALL_HEADER]}x`,
    (assistantCallHeaders()[ASSISTANT_CALL_HEADER] ?? "").slice(1),
  ])("a wrong proof is refused (%j)", (proof) => {
    expect(
      isAssistantRequest(OFF, request({ [ASSISTANT_CALL_HEADER]: proof })),
    ).toBe(false);
  });

  test("an acting header claiming the manager is untrusted and ignored", () => {
    expect(isAssistantRequest(OFF, request(VIA))).toBe(false);
  });

  test("a plain request is a person's", () => {
    expect(isAssistantRequest(OFF, request({}))).toBe(false);
  });
});

describe("behind the gateway (managed pod)", () => {
  test("the gateway-minted via claim marks the manager", () => {
    expect(isAssistantRequest(ON, request(VIA, "10.0.0.7"))).toBe(true);
  });

  test("the loopback proof is ignored", () => {
    expect(isAssistantRequest(ON, request(assistantCallHeaders()))).toBe(false);
  });

  test("any other via, or none, is not the manager", () => {
    const other = { [ACTING_AS_HEADER]: acting({ sub: "u1", via: "gcip" }) };
    const none = { [ACTING_AS_HEADER]: acting({ sub: "u1" }) };
    expect(isAssistantRequest(ON, request(other))).toBe(false);
    expect(isAssistantRequest(ON, request(none))).toBe(false);
  });
});

test("the proof is unguessable: 32 random bytes", () => {
  const proof = assistantCallHeaders()[ASSISTANT_CALL_HEADER] ?? "";
  expect(Buffer.from(proof, "base64url")).toHaveLength(32);
});
