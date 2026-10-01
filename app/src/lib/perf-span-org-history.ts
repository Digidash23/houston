/**
 * Which hosted org was active when, so a turn's spans carry the org it was
 * SENT in even when its answer lands after a space switch (a turn keeps
 * streaming across a switch; only a sign-out tears it down). Bounded: a turn
 * older than everything remembered goes untagged rather than guessed.
 */
const MAX_ENTRIES = 32;

export class OrgHistory {
  private readonly entries: Array<{ since: number; slug: string | null }> = [];

  /** The active org from `at` on (epoch ms); null where there is none. */
  set(slug: string | null, at: number): void {
    if (this.entries.at(-1)?.slug === slug) return;
    this.entries.push({ since: at, slug });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  /** The org that was active at `at`: the latest change at or before it. */
  at(at: number): string | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry && entry.since <= at) return entry.slug;
    }
    return null;
  }
}
