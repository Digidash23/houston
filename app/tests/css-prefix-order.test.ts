import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { it } from "node:test";

import { REPO, sourceRoots, walk } from "./token-discipline-rules.ts";

/**
 * Tailwind's production `optimize()` (lightningcss) keeps only the LAST of a
 * standard property and its `-webkit-` spelling in one block. Written
 * standard-first, the build ships WebKit's spelling alone, so every Chromium
 * surface (Android, Chrome on a phone, Windows WebView2) silently loses the
 * effect while Safari and the dev server still show it. Prefixed first keeps
 * both. Only these two properties lose the standard spelling that way.
 */
const PAIRED = ["backdrop-filter", "filter"];

function misordered(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const block of code.split(/[{}]/)) {
    for (const property of PAIRED) {
      const prefixed = block.search(new RegExp(`-webkit-${property}\\s*:`));
      const standard = block.search(new RegExp(`(?<![-\\w])${property}\\s*:`));
      if (prefixed !== -1 && standard !== -1 && standard < prefixed)
        found.push(property);
    }
  }
  return found;
}

it("writes every -webkit- spelling before its standard property", () => {
  const offences = sourceRoots()
    .flatMap((root) => walk(root))
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) =>
      misordered(readFileSync(file, "utf8")).map(
        (property) => `${relative(REPO, file)}: ${property}`,
      ),
    );
  deepStrictEqual(offences, []);
});

it("flags the standard-first order the build drops", () => {
  deepStrictEqual(
    misordered(
      ".a { backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }",
    ),
    ["backdrop-filter"],
  );
  deepStrictEqual(
    misordered(
      ".a { -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }",
    ),
    [],
  );
});
