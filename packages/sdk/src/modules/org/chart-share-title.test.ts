import { describe, expect, it } from "vitest";
import {
  isAcceptedOrgChartShareTitle,
  ORG_CHART_SHARE_FALLBACK_TITLE,
  orgChartShareTitle,
} from "./chart-share-title";

/** The tag characters spelling `code`, as in a subdivision flag. */
const tags = (code: string) =>
  Array.from(code, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join(
    "",
  );
const flag = (code: string) => `\u{1F3F4}${tags(code)}\u{E007F}`;
const ENGLAND = flag("gbeng");

/**
 * The gateway's own title vectors (cloud `orgchartroutes/routes_test.go`,
 * `TestUploadRefusals` title cases), verbatim.
 */
const GATEWAY_REFUSED: Record<string, string> = {
  "blank title": "   ",
  "long title": "é".repeat(121),
  "control char title": "a\u0000b",
  "bidi override title": "a‮b",
  "zero-width title": "a​b",
  "joiner run title": `Acme${"‍".repeat(40)}`,
  "joiner-only title": "‍",
  "doubled joiner title": "a‍‍b",
  "leading joiner title": "‍Acme",
  "non-joiner run title": `Acme${"‌".repeat(40)}`,
  "joiner beside a space title": "a ‍b",
  "joiner before a mark title": "a‍́",
  "joiner mark chain title": "a‍́‍́",
  "joiner virama chain title": "র‍্‍্",
  "stray tag character": "a\u{E0067}b",
  "tags without a flag": `a${tags("gbeng")}\u{E007F}`,
  "flag tags never cancelled": `\u{1F3F4}${tags("gbeng")}`,
  "flag with too few tags": `\u{1F3F4}${tags("gb")}\u{E007F}`,
  "flag with too many tags": `\u{1F3F4}${tags("gbengg")}\u{E007F}`,
  "flag with an uppercase tag": `\u{1F3F4}\u{E0047}${tags("beng")}\u{E007F}`,
  "tag after a complete flag": `${ENGLAND}\u{E0067}`,
  "language tag": "a\u{E0001}b",
  "other subdivision flag": flag("usca"),
  "flag tags prefix of a recommended one": flag("gbe"),
  "smuggled variation selectors": `Acme${"️".repeat(40)}`,
  "supplementary variation selector": "Acme\u{E0100}",
  "variation selector 1": "Acme︀",
  "mongolian variation selector": "Acme᠋",
  "emoji selector leading": "️Acme",
  "emoji selector after a space": "Acme ️x",
  "emoji selector after a mark": "é️",
  "emoji selector after a joiner": "a‍️",
  "text and emoji selectors stacked": "❤︎️",
  "combining grapheme joiner": "a͏b",
  "hangul filler": "aㅤb",
  "halfwidth hangul filler": "aﾠb",
};

/**
 * The gateway's accepted vectors (`TestUploadTitleKeepsCombinedEmoji`,
 * `TestUploadTitleAtLimit`), verbatim.
 */
const GATEWAY_ACCEPTED: Record<string, string> = {
  "zero-width joiner family": "Acme \u{1F468}‍\u{1F469}‍\u{1F467}",
  "rainbow flag": "\u{1F3F3}️‍\u{1F308}",
  "skin tone joiner": "\u{1F469}\u{1F3FD}‍\u{1F4BB}",
  "devanagari conjunct": "क्‍ष",
  "persian non-joiner": "می‌خواهم",
  "bengali ya-phala": "র‍্যাব",
  "trans flag": "\u{1F3F3}️‍⚧️",
  "pirate flag": "\u{1F3F4}‍☠️",
  "regional indicator flag": "Acme \u{1F1E8}\u{1F1F4}",
  cjk: "東京株式会社",
  arabic: "شركة أكمي",
  "devanagari matra": "किताब",
  "tag-sequence flag": `Acme ${ENGLAND}`,
  "two flags": `${flag("gbsct")} ${flag("gbwls")}`,
  "plain black flag": "Acme \u{1F3F4}",
  "scotland flag": flag("gbsct"),
  "wales flag": flag("gbwls"),
  "emoji-style heart": "Acme ❤️",
  "text-style heart": "Acme ❤︎",
  "styled flag": "Acme \u{1F3F4}️",
  keycap: "1️⃣ Acme",
  "styled emoji in a join": "\u{1F3F3}️‍\u{1F308}",
  "title at limit": "é".repeat(120),
};

/** Titles the reviews found the old cleaner sent and the gateway refuses. */
const FOUND_REFUSED: Record<string, string> = {
  "trailing joiner": "Acme‍",
  "joiner after a space": "Acme ‍",
  "selector after a combining mark": "Café️",
  "selector after a subdivision flag": `Acme ${ENGLAND}️`,
  "cut leaving a trailing joiner": `${"a".repeat(119)}\u{1F468}‍\u{1F469}`,
  "lone surrogate": "Acme \ud83d",
};

/**
 * What each refused vector cleans into: visible text survives, and only a
 * title with nothing left falls back to `ORG_CHART_SHARE_FALLBACK_TITLE`.
 */
const CLEANED: Record<string, string> = {
  "blank title": ORG_CHART_SHARE_FALLBACK_TITLE,
  "long title": "\u00e9".repeat(120),
  "control char title": "ab",
  "bidi override title": "ab",
  "zero-width title": "ab",
  "joiner run title": "Acme",
  "joiner-only title": ORG_CHART_SHARE_FALLBACK_TITLE,
  "doubled joiner title": "a\u200Db",
  "leading joiner title": "Acme",
  "non-joiner run title": "Acme",
  "joiner beside a space title": "a b",
  "joiner before a mark title": "a\u0301",
  "joiner mark chain title": "a\u0301\u0301",
  "joiner virama chain title": "\u09B0\u200D\u09CD\u09CD",
  "stray tag character": "ab",
  "tags without a flag": "a",
  "flag tags never cancelled": "\u{1F3F4}",
  "flag with too few tags": "\u{1F3F4}",
  "flag with too many tags": "\u{1F3F4}",
  "flag with an uppercase tag": "\u{1F3F4}",
  "tag after a complete flag": ENGLAND,
  "language tag": "ab",
  "other subdivision flag": "\u{1F3F4}",
  "flag tags prefix of a recommended one": "\u{1F3F4}",
  "smuggled variation selectors": "Acme\uFE0F",
  "supplementary variation selector": "Acme",
  "variation selector 1": "Acme",
  "mongolian variation selector": "Acme",
  "emoji selector leading": "Acme",
  "emoji selector after a space": "Acme x",
  "emoji selector after a mark": "e\u0301",
  "emoji selector after a joiner": "a\uFE0F",
  "text and emoji selectors stacked": "\u2764\uFE0E",
  "combining grapheme joiner": "ab",
  "hangul filler": "ab",
  "halfwidth hangul filler": "ab",
  "trailing joiner": "Acme",
  "joiner after a space": "Acme",
  "selector after a combining mark": "Cafe\u0301",
  "selector after a subdivision flag": `Acme ${ENGLAND}`,
  "cut leaving a trailing joiner": `${"a".repeat(119)}\u{1F468}`,
  "lone surrogate": "Acme \uFFFD",
};

describe("isAcceptedOrgChartShareTitle", () => {
  it.each(Object.entries(GATEWAY_REFUSED))("refuses %s", (_, title) => {
    expect(isAcceptedOrgChartShareTitle(title)).toBe(false);
  });

  it.each(Object.entries(GATEWAY_ACCEPTED))("accepts %s", (_, title) => {
    expect(isAcceptedOrgChartShareTitle(title)).toBe(true);
  });

  it("trims Unicode white space as the gateway does, and refuses an empty title", () => {
    expect(isAcceptedOrgChartShareTitle("  Our team 　\u0085")).toBe(true);
    expect(isAcceptedOrgChartShareTitle("")).toBe(false);
    expect(isAcceptedOrgChartShareTitle("﻿Acme")).toBe(false);
  });

  it("accepts a joiner after a text style selector, which is a mark", () => {
    expect(isAcceptedOrgChartShareTitle("a︎‍b")).toBe(true);
  });
});

describe("orgChartShareTitle", () => {
  it.each(
    Object.entries({ ...GATEWAY_REFUSED, ...FOUND_REFUSED }),
  )("cleans %s into the title it pins, which the gateway accepts", (name, title) => {
    const cleaned = orgChartShareTitle(title);
    expect(cleaned).toBe(CLEANED[name]);
    expect(isAcceptedOrgChartShareTitle(cleaned)).toBe(true);
  });

  it("pins a cleaned title for every refused vector", () => {
    expect(Object.keys(CLEANED).sort()).toEqual(
      Object.keys({ ...GATEWAY_REFUSED, ...FOUND_REFUSED }).sort(),
    );
  });

  it.each(
    Object.entries(GATEWAY_ACCEPTED),
  )("leaves %s unchanged", (_, title) => {
    expect(orgChartShareTitle(title)).toBe(title);
  });

  it("drops a joiner or selector its kept neighbours no longer allow", () => {
    expect(orgChartShareTitle("Acme‍")).toBe("Acme");
    expect(orgChartShareTitle("‍Acme ‍")).toBe("Acme");
    expect(orgChartShareTitle("a‍‍b")).toBe("a‍b");
    expect(orgChartShareTitle("Café️")).toBe("Café");
    expect(orgChartShareTitle(`${ENGLAND}️`)).toBe(ENGLAND);
    expect(orgChartShareTitle("a​‍​b")).toBe("a‍b");
  });

  it("cuts at 120 code points without splitting an emoji, a flag or leaving a joiner", () => {
    const long = `${"a".repeat(119)}🚀🚀`;
    expect(Array.from(orgChartShareTitle(long))).toHaveLength(120);
    expect(orgChartShareTitle(long).endsWith("🚀")).toBe(true);
    expect(orgChartShareTitle(`${"a".repeat(117)}${ENGLAND}`)).toBe(
      "a".repeat(117),
    );
    expect(orgChartShareTitle(`${"a".repeat(119)}\u{1F468}‍\u{1F469}`)).toBe(
      `${"a".repeat(119)}\u{1F468}`,
    );
  });

  it("drops bidi overrides, zero-width spaces, control and default-ignorable characters", () => {
    expect(orgChartShareTitle("‮Ac​me\u0007⁦")).toBe("Acme");
    expect(orgChartShareTitle("A͏cᅟmㅤeﾠ᠋")).toBe("Acme");
    expect(orgChartShareTitle("Acme︀︁︍\u{E0100}\u{E01EF}")).toBe("Acme");
  });

  it("keeps a presentation selector after a visible character, once", () => {
    expect(orgChartShareTitle("Acme️️︎")).toBe("Acme️");
    expect(orgChartShareTitle("️Acme ️")).toBe("Acme");
  });

  it("strips a non-standard tag sequence and stray tag characters", () => {
    expect(orgChartShareTitle(`Acme ${flag("usca")}`)).toBe("Acme \u{1F3F4}");
    expect(orgChartShareTitle(`Ac${tags("hi")}me\u{E007F}`)).toBe("Acme");
  });

  it("falls back when nothing the gateway takes is left", () => {
    for (const blank of ["", "   ", "​‮", "‍", " \u0000 "])
      expect(orgChartShareTitle(blank)).toBe(ORG_CHART_SHARE_FALLBACK_TITLE);
  });

  it("sends a lone surrogate as the replacement character its encoding becomes", () => {
    expect(orgChartShareTitle("Acme \uD83D")).toBe("Acme �");
    expect(orgChartShareTitle(`${"a".repeat(119)}\uD83D\uD83D`)).toBe(
      `${"a".repeat(119)}�`,
    );
  });
});
