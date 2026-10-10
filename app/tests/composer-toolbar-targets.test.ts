import { ok } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The selectors reach the session hooks (Vite's `import.meta.env`), so the node
// runner pins their phone sizing on source; the Playwright phone project and a
// 360/412px measurement cover the rendered row.
const read = (path: string) =>
  readFileSync(new URL(`../src/components/${path}`, import.meta.url), "utf8");

const PILL =
  "flex items-center justify-center gap-1.5 h-11 min-w-11 px-2 rounded-lg text-xs text-ink-muted whitespace-nowrap hover:text-ink hover:bg-hover transition-[color,background-color,scale] active:scale-[0.96] outline-none md:h-7 md:min-w-0 md:active:scale-100";

describe("the composer toolbar on a phone", () => {
  it("draws mode, model and effort as 44px targets, 28px from md", () => {
    for (const file of [
      "chat-mode-selector.tsx",
      "chat-model-selector.tsx",
      "chat-effort-selector.tsx",
    ]) {
      ok(read(file).includes(PILL), `${file}: not the phone pill`);
    }
  });

  it("draws the context ring as a 44px target, 28px from md", () => {
    const src = read("context-indicator.tsx");
    ok(src.includes("size-11"));
    ok(src.includes("md:size-7"));
    ok(src.includes("transition-[color,background-color,scale]"));
    ok(
      src.includes("active:scale-[0.96]") &&
        src.includes("md:active:scale-100"),
    );
  });

  it("scrolls sideways on a phone instead of crowding, never on desktop", () => {
    const src = read("use-agent-chat-panel.tsx");
    ok(
      src.includes(
        'className="flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] md:gap-2 md:overflow-visible"',
      ),
    );
  });
});
