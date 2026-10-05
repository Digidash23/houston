import type { MessageAdmissionReceipt } from "@houston/protocol";
import { MESSAGE_ADMISSION_RETENTION_MS } from "../store/message-admissions";

/**
 * The messages one conversation of Houston's has admitted, by nonce, for as
 * long as a standing runtime keeps its admission receipts (a week).
 *
 * The approval records' own reservations last ten minutes, as an approval
 * does; a retry that arrives after that (a redispatched turn, a client that
 * re-sent) must still read as the same message, so its answers and grants
 * are not applied twice. This is the durable receipt a host reads before it
 * touches approvals (`assistant/message-admission-read.ts`), kept beside the
 * approval records instead of one file per message.
 */
interface Admitted {
  hostFingerprint: string;
  turnId: string;
  at: number;
}

export class AdmittedMessages {
  private readonly byNonce: Map<string, Admitted>;

  constructor(
    carried: unknown,
    private readonly now: () => number = Date.now,
  ) {
    this.byNonce = new Map();
    if (typeof carried !== "object" || carried === null) return;
    for (const [nonce, value] of Object.entries(carried)) {
      const entry = value as Partial<Admitted>;
      if (
        typeof entry.hostFingerprint === "string" &&
        typeof entry.turnId === "string" &&
        entry.turnId !== "" &&
        typeof entry.at === "number" &&
        this.now() - entry.at < MESSAGE_ADMISSION_RETENTION_MS
      )
        this.byNonce.set(nonce, {
          hostFingerprint: entry.hostFingerprint,
          turnId: entry.turnId,
          at: entry.at,
        });
    }
  }

  /** The receipt a host would read for this nonce, or null for a new one. */
  receipt(nonce: string): MessageAdmissionReceipt | null {
    const entry = this.byNonce.get(nonce);
    return entry
      ? {
          version: 1,
          fingerprint: entry.hostFingerprint,
          hostFingerprint: entry.hostFingerprint,
          turnId: entry.turnId,
        }
      : null;
  }

  record(nonce: string, hostFingerprint: string, turnId: string): void {
    this.byNonce.set(nonce, { hostFingerprint, turnId, at: this.now() });
  }

  /**
   * What the record file keeps: the week's admissions, older ones dropped.
   * Built with `fromEntries` so every nonce is an own key, `__proto__`
   * included (an assignment would set the prototype and lose the entry).
   */
  toJSON(): Record<string, Admitted> {
    return Object.fromEntries(
      [...this.byNonce].filter(
        ([, entry]) => this.now() - entry.at < MESSAGE_ADMISSION_RETENTION_MS,
      ),
    );
  }
}
