import { ok } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A failed skill write is silent to the USER — the engine call already toasted
 * its real reason — but it must never be silent to US. An empty catch is the
 * one shape that loses the failure entirely, so the whole surface is scanned
 * for it rather than the two handlers that carried it.
 */
const dir = new URL("../src/components/skills-view/", import.meta.url);

const sources = readdirSync(dir)
  .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  .map((name) => [name, readFileSync(new URL(name, dir), "utf8")] as const);

describe("the Skills surface swallows nothing", () => {
  it("has no empty catch anywhere in it", () => {
    for (const [name, src] of sources)
      ok(
        !/\.catch\(\(\s*\)\s*=>\s*(\{\s*\}|null|\[\]|undefined)\s*\)/.test(src),
        `${name} drops a rejection on the floor`,
      );
  });

  it("never calls a half-applied delete for everyone a success", () => {
    const actions = readFileSync(
      new URL("use-shared-skills-actions.ts", dir),
      "utf8",
    );
    const body = actions.slice(
      actions.indexOf("const deleteShared = useCallback("),
      actions.indexOf("const promoteToShared = useCallback("),
    );
    // A manifest write that failed leaves some employee loading a deleted
    // skill: the act rethrows the refusal (reported once, unless `call()`
    // already explained it) instead of toasting success.
    ok(body.includes("throwFirstRefusal(settled);"));
    ok(
      body.indexOf("throwFirstRefusal(settled);") <
        body.indexOf('addToast({ title: t("global.skillRemoved")'),
    );
  });

  it("names the writes the save flow and the menu report", () => {
    const save = readFileSync(new URL("use-skill-save.ts", dir), "utf8");
    ok(save.includes('logAndReportError("skill_delete"'), "the delete");
    const menu = readFileSync(
      new URL("workspace-skill-menu-items.tsx", dir),
      "utf8",
    );
    ok(menu.includes('report("skill_share_to_workspace")'), "the share");
    ok(menu.includes('report("skill_enable_for_all")'), "the enable");
    const page = readFileSync(new URL("skill-editor-page.tsx", dir), "utf8");
    ok(
      page.includes('logAndReportError("skill_delete_for_everyone"'),
      "the delete for everyone",
    );
  });
});
