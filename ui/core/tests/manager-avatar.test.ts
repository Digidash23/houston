import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { avatarHelmetSize } from "../src/components/houston-avatar.tsx";
import { ManagerAvatar } from "../src/components/manager-avatar.tsx";

const render = (size: number, className?: string) =>
  renderToStaticMarkup(createElement(ManagerAvatar, { size, className }));

const idsOf = (html: string) =>
  [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

/** The vertices of the avatar's shape, in its 100-unit viewBox. */
function shapePoints(html: string): [number, number][] {
  const d = html.match(/<clipPath[^>]*><path d="([^"]+)"/)?.[1];
  assert.ok(d, "the shape is drawn as a path");
  return [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

/** The primary Button's paint, as canvas.css §4 declares it. */
function buttonPaint(): { fill: string; rim: string; label: string } {
  const css = readFileSync(
    new URL("../src/canvas.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(
    /\[data-variant="default"\]:is\(button, a\) \{([^}]+)\}/,
  )?.[1];
  assert.ok(rule, "canvas.css paints the primary Button");
  const token = (pattern: RegExp) => {
    const found = rule.match(pattern)?.[1];
    assert.ok(found, String(pattern));
    return found;
  };
  return {
    fill: token(/background: (var\(--ht-[\w-]+\));/),
    rim: token(/inset 0 0 0 1px (var\(--ht-[\w-]+\));/),
    label: token(/\bcolor: (var\(--ht-[\w-]+\));/),
  };
}

describe("ManagerAvatar", () => {
  it("fills the requested square box and stays decorative", () => {
    for (const size of [16, 24, 32, 52, 96]) {
      const html = render(size, "extra");
      assert.match(html, new RegExp(`width="${size}" height="${size}"`));
      assert.match(html, /viewBox="0 0 100 100"/);
      assert.match(html, /aria-hidden="true"/);
      assert.match(html, /class="shrink-0 extra"/);
    }
  });

  it("draws a true superellipse, not a circle or a rounded square", () => {
    const points = shapePoints(render(32));
    assert.ok(points.length >= 64, `${points.length} vertices`);
    for (const [x, y] of points) {
      const nx = Math.abs(x - 50) / 50;
      const ny = Math.abs(y - 50) / 50;
      // |x|^5 + |y|^5 = 1, within the path's two-decimal rounding.
      assert.ok(Math.abs(nx ** 5 + ny ** 5 - 1) < 0.01, `${x},${y}`);
    }
    // Its 45-degree corner sits well outside a circle's (0.707) and inside a
    // square's (1).
    const corner = Math.max(
      ...points.map(([x, y]) => Math.min(x - 50, y - 50) / 50),
    );
    assert.ok(corner > 0.8 && corner < 0.9, `corner at ${corner}`);
  });

  it("wears the primary Button's own fill, rim and label tokens", () => {
    const paint = buttonPaint();
    for (const size of [20, 52]) {
      const html = render(size);
      assert.ok(html.includes(`fill:${paint.fill}`), `${size}px fill`);
      assert.ok(html.includes(`stroke:${paint.rim}`), `${size}px rim`);
      assert.ok(html.includes(`fill:${paint.label}`), `${size}px helmet`);
    }
  });

  it("paints no colour of its own and fakes no depth", () => {
    for (const size of [20, 52]) {
      const html = render(size);
      const vars = new Set(html.match(/var\(--ht-[\w-]+\)/g));
      assert.deepEqual([...vars].sort(), [
        "var(--ht-cta)",
        "var(--ht-cta-rim)",
        "var(--ht-cta-text)",
      ]);
      assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b|rgba?\(/i);
      assert.doesNotMatch(html, /<filter|Gradient|mask=/, `${size}px`);
    }
    for (const file of ["manager-avatar.tsx", "manager-avatar-geometry.ts"]) {
      const source = readFileSync(
        new URL(`../src/components/${file}`, import.meta.url),
        "utf8",
      );
      assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(/i, file);
    }
  });

  it("keeps the rim one pixel inside the edge at every size", () => {
    for (const size of [20, 24, 52, 96]) {
      const html = render(size);
      assert.match(
        html,
        /stroke-width="2" vector-effect="non-scaling-stroke" clip-path="url\(#[\w-]+\)"/,
        `${size}px`,
      );
    }
  });

  it("seats the helmet on whole pixels, sized like the employee avatar's", () => {
    for (const size of [20, 24, 28, 52]) {
      const glyphPx = avatarHelmetSize(size);
      const insetPx = (size - glyphPx) / 2;
      assert.ok(Number.isInteger(insetPx), `${size}px inset ${insetPx}`);
      const unit = (px: number) => Number(((px * 100) / size).toFixed(3));
      const html = render(size);
      const at = unit(insetPx);
      assert.ok(html.includes(`translate(${at} ${at})`), `${size}px seat`);
      const glyph = unit(glyphPx);
      assert.ok(
        html.includes(`width="${glyph}" height="${glyph}"`),
        `${size}px glyph`,
      );
    }
    assert.match(render(32), /viewBox="0 0 412\.248 448\.898"/);
  });

  it("gives every instance its own ids, every one referenced", () => {
    for (const size of [52, 20]) {
      const html = renderToStaticMarkup(
        createElement(
          Fragment,
          null,
          createElement(ManagerAvatar, { size }),
          createElement(ManagerAvatar, { size }),
        ),
      );
      const ids = idsOf(html);
      assert.equal(ids.length, idsOf(render(size)).length * 2);
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) {
        assert.match(id, /^[\w-]+$/);
        assert.ok(html.includes(`url(#${id})`), id);
      }
    }
  });
});
