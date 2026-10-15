import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { isClosedError } from "./live/page-errors";
import { lookEpoch } from "./look-memory";
import type { BrowserTab } from "./open-tab";
import { nextGeneration } from "./refs";
import { ariaTree } from "./snapshot";
import { parseTree, walk } from "./snapshot-tree";
import { isInteractive } from "./snapshot-view";

/** Badges past this many hide the page they label. */
export const MAX_LABELS = 80;
/** Elements measured to find the visible ones; a page lists more off screen. */
const MAX_MEASURED = 400;
const MEASURE_TIMEOUT_MS = 1_000;

export interface ScreenLabel {
  /** Stamped, as click takes it (`s7e12`). */
  ref: string;
  role: string;
  name: string;
}

interface Badge {
  text: string;
  x: number;
  y: number;
}

/**
 * A screenshot with each visible control's ref drawn at its corner, so the
 * model can click what it sees. Counts as a look: the refs drawn are a new
 * generation. The overlay lives in a closed shadow root that takes no input
 * and is removed whatever happens.
 */
export async function labeledScreenshot(
  tab: BrowserTab,
  shoot: (page: Page) => Promise<Buffer>,
): Promise<{ image: Buffer; labels: ScreenLabel[] }> {
  const page = tab.page;
  const epoch = lookEpoch(tab);
  const tree = await ariaTree(page);
  const controls = tree
    ? [...walk(parseTree(tree))]
        .filter((n) => n.ref !== undefined && isInteractive(n))
        .slice(0, MAX_MEASURED)
    : [];
  const viewport = page.viewportSize();
  const measured = await Promise.all(
    controls.map(async (node) => ({
      node,
      box: await boxOf(page, node.ref ?? ""),
    })),
  );
  const generation = nextGeneration();
  if (tab.page === page && lookEpoch(tab) === epoch)
    tab.generation = generation;
  const visible = measured
    .flatMap(({ node, box }) =>
      box && viewport && onScreen(box, viewport) ? [{ node, box }] : [],
    )
    .slice(0, MAX_LABELS);
  const labels = visible.map(({ node }) => ({
    ref: `s${generation}${node.ref}`,
    role: node.role,
    name: node.name ?? "",
  }));
  const badges: Badge[] = visible.map(({ box }, i) => ({
    text: labels[i]?.ref ?? "",
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
  }));
  const id = `houston-labels-${randomUUID()}`;
  await page.evaluate(drawBadges, { id, badges });
  try {
    return { image: await shoot(page), labels };
  } finally {
    await removeBadges(page, id);
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Null for an element hidden, gone, or too slow to measure. */
async function boxOf(page: Page, ref: string): Promise<Box | null> {
  try {
    return await page
      .getByRef(ref)
      .boundingBox({ timeout: MEASURE_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return null;
    throw error;
  }
}

function onScreen(box: Box, viewport: { width: number; height: number }) {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.x < viewport.width &&
    box.y < viewport.height &&
    box.x + box.width > 0 &&
    box.y + box.height > 0
  );
}

/** Runs in the page. */
function drawBadges({ id, badges }: { id: string; badges: Badge[] }): void {
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  for (const badge of badges) {
    const el = document.createElement("div");
    el.textContent = badge.text;
    el.style.cssText = `position:fixed;left:${badge.x}px;top:${badge.y}px;font:bold 11px/1.2 monospace;padding:1px 3px;background:yellow;color:black;border:1px solid black;border-radius:3px;white-space:nowrap;pointer-events:none;`;
    root.append(el);
  }
  document.documentElement.append(host);
}

/** A page that navigated meanwhile took the overlay with it. */
async function removeBadges(page: Page, id: string): Promise<void> {
  try {
    await page.evaluate(
      (hostId) => document.getElementById(hostId)?.remove(),
      id,
    );
  } catch (error) {
    if (
      isClosedError(error) ||
      (error instanceof Error &&
        error.message.includes("Execution context was destroyed"))
    )
      return;
    throw error;
  }
}
