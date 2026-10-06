/**
 * Client UX timing spans (HOU-1011). Measures app open → board cards painted,
 * card click → chat painted, and for every sent turn send → first visible text
 * and send → first visible activity (thinking, a tool call, or text), and ships them
 * to the gateway's `/v1/client-metrics` ingest (Prometheus histograms behind
 * grafana.gethouston.ai) plus a PostHog mirror for per-user drill-down. Only
 * the mirror carries the hosted org slug and the send's outcome: the gateway
 * ingest rejects unknown fields, and its histograms stay without org labels.
 *
 * The send spans are not paired here: the SDK reports each sent turn's first
 * response (`FirstResponse`, from that turn's own frames), and this module
 * only turns the report into spans. Every turn the client sends is measured,
 * whichever surface sent it, and a slow or failed one is kept with its outcome.
 *
 * Pure module: no React, no Tauri, no fetch of its own until `configure()`
 * injects the transport. All clocks are epoch ms (performance.timeOrigin as
 * the web T0; the Tauri shell upgrades T0 to its process start).
 */

import type { FirstResponse, FirstResponseOutcome } from "@houston/sdk";
import { turnSpans } from "./perf-span-marks";
import { OrgHistory } from "./perf-span-org-history";

export type PerfSpanName =
  | "app_to_board"
  | "card_click_to_chat"
  | "send_to_first_response"
  | "send_to_first_activity";

export interface PerfSpanObservation {
  span: PerfSpanName;
  ms: number;
}

/** What a mirrored span carries beyond its duration. */
export interface PerfSpanTags {
  /** The hosted org a send ran in; null on spans no send pairs and off the gateway. */
  orgSlug: string | null;
  /** How the turn behind a send span ended up; absent on the other spans. */
  outcome?: FirstResponseOutcome;
}

export interface PerfSpanTransport {
  /**
   * POST a batch to the gateway; absent session → don't call configure yet.
   * Omitted entirely when the build bakes no ingest URL (there is no default
   * host to fall back to): spans are still measured and mirrored, just never
   * shipped, and the queue is dropped instead of growing forever.
   */
  send?(spans: PerfSpanObservation[]): Promise<void>;
  /** Per-span mirror (PostHog). Fire-and-forget. */
  mirror?(span: PerfSpanName, ms: number, tags: PerfSpanTags): void;
}

/** A card click older than this is stale (user wandered off) — never completed. */
const PENDING_TTL_MS = 60_000;
const FLUSH_DELAY_MS = 5_000;

export class PerfSpans {
  private t0Ms: number;
  private readonly onceDone = new Set<PerfSpanName>();
  private pendingChatOpenAt: number | null = null;
  private readonly orgs = new OrgHistory();
  private queue: PerfSpanObservation[] = [];
  private transport: PerfSpanTransport | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(opts?: { t0Ms?: number; now?: () => number }) {
    this.now = opts?.now ?? Date.now;
    this.t0Ms =
      opts?.t0Ms ??
      (typeof performance !== "undefined"
        ? performance.timeOrigin
        : this.now());
  }

  /** The Tauri shell's process-start stamp — earlier than the webview's. */
  setLaunchT0(epochMs: number): void {
    // Only ever move T0 earlier: a late (buggy) stamp must not shrink spans.
    if (Number.isFinite(epochMs) && epochMs < this.t0Ms) this.t0Ms = epochMs;
  }

  configure(transport: PerfSpanTransport): void {
    this.transport = transport;
    if (this.queue.length > 0) this.scheduleFlush();
  }

  /** Mission cards painted with resolved data. Once per app session. */
  boardRendered(): void {
    this.observeOnce("app_to_board", this.now() - this.t0Ms);
  }

  /** The user opened a mission card (chat panel about to load). */
  cardClicked(): void {
    this.pendingChatOpenAt = this.now();
  }

  /** The opened conversation's messages painted. Completes cardClicked. */
  chatRendered(): void {
    const at = this.take(this.pendingChatOpenAt);
    this.pendingChatOpenAt = null;
    if (at !== null) this.observe("card_click_to_chat", this.now() - at);
  }

  /** The hosted org slug of the active space from now on, or null where there is none. */
  setOrgSlug(slug: string | null): void {
    this.orgs.set(slug, this.now());
  }

  /** The org a send dispatched at `at` (epoch ms) ran in. */
  orgSlugAt(at: number): string | null {
    return this.orgs.at(at);
  }

  /**
   * A sent turn's first response, as the SDK paired it:
   * `send_to_first_response` with its outcome, and `send_to_first_activity`
   * when the turn showed anything (or timed out showing nothing, censored like
   * a text timeout). Tagged with the org the turn was SENT in.
   */
  turnResponded(response: FirstResponse): void {
    const { outcome, sentAt } = response;
    const tags: PerfSpanTags = { orgSlug: this.orgs.at(sentAt), outcome };
    for (const { span, ms, ship } of turnSpans(response))
      this.observe(span, ms, tags, ship);
  }

  /** Ship anything queued now (page-hide, tests). */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.transport || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    // Mirror-only build (no ingest URL baked): drop the batch rather than let
    // it accumulate for a transport that will never exist.
    if (!this.transport.send) return;
    try {
      await this.transport.send(batch);
    } catch {
      // Re-queue once so a transient network blip isn't a lost sample; a
      // second failure drops the batch (metrics are best-effort, never noise).
      if (batch.length + this.queue.length <= 40) this.queue.unshift(...batch);
    }
  }

  private take(at: number | null): number | null {
    if (at === null) return null;
    return this.now() - at <= PENDING_TTL_MS ? at : null;
  }

  private observeOnce(
    span: PerfSpanName,
    ms: number,
    tags: PerfSpanTags = { orgSlug: null },
  ): void {
    if (this.onceDone.has(span)) return;
    this.onceDone.add(span);
    this.observe(span, ms, tags);
  }

  /** `ship: false` mirrors the span to PostHog only (never the gateway histogram). */
  private observe(
    span: PerfSpanName,
    ms: number,
    tags: PerfSpanTags = { orgSlug: null },
    ship = true,
  ): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.transport?.mirror?.(span, Math.round(ms), tags);
    if (!ship) return;
    this.queue.push({ span, ms: Math.round(ms) });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.transport || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
    // Never keep the process alive for a metrics flush (tests, shutdown).
    (this.flushTimer as { unref?: () => void }).unref?.();
  }
}

/** The app-wide singleton the wiring hook and call sites share. */
export const perfSpans = new PerfSpans();
