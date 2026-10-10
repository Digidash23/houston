import { ok } from "node:assert";
import { before, describe, it } from "node:test";
import i18next from "i18next";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initReactI18next } from "react-i18next";
import { ProviderButtonRow } from "../src/components/auth/provider-button-row.tsx";
import auth from "../src/locales/en/auth.json" with { type: "json" };

Object.assign(globalThis, { React });

before(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    ns: ["auth"],
    defaultNS: "auth",
    resources: { en: { auth } },
  });
});

const classesOf = (element: ReactElement, selector: string): string[][] =>
  [
    ...new JSDOM(
      renderToStaticMarkup(element),
    ).window.document.querySelectorAll(selector),
  ].map((node) => (node.getAttribute("class") ?? "").split(/\s+/));

// The sign-in card is the first screen of the store apps: its controls are 44px
// on a phone (the unprefixed layer) and keep their 40px desktop box at md:.
// (EmailSignIn and LegalFooter reach `import.meta.env` through lib/auth and
// lib/tauri, which the node runner cannot load; their targets were measured on
// the Android emulator instead.)
describe("sign-in phone tap targets", () => {
  it("provider pills are 44px on a phone and 40px from md", () => {
    const pills = classesOf(
      createElement(ProviderButtonRow, {
        pending: null,
        onSignIn: () => () => undefined,
      }),
      "button",
    );
    ok(pills.length > 0);
    for (const c of pills) {
      ok(c.includes("h-11") && c.includes("md:h-10"), c.join(" "));
      ok(c.includes("active:scale-[0.96]"), "press feedback");
    }
  });
});
