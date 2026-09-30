import type { ChatMessage } from "@houston/runtime-client";
import type { ArchiveIndex } from "./conversation-archive";

/**
 * The shape of one conversation file (conversation-file.ts owns reading and
 * writing it).
 */
export type StoredConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /**
   * Set when the backend-native session state was deliberately reset while the
   * transcript kept messages (a truncation's edit-and-resend, PRODUCT-1217):
   * the next turn must carry the kept transcript into its fresh session as a
   * replay preamble (HOU-951). One-shot — exec-turn consumes it. Durable here
   * (not in-memory) so a runtime restart between the reset and the next turn
   * cannot lose the carried context.
   */
  needsSessionReplay?: true;
  /**
   * The durable half of a Claude `/compact`: the summary the NEXT prompt opens
   * its fresh session with, written BEFORE the resume mapping is dropped and
   * removed only once that prompt succeeds (`conversation-compaction.ts`). On
   * disk so a restart, an eviction or a mode switch between the two cannot lose
   * the compacted history.
   */
  claudeCompaction?: CompactionCheckpoint;
  /**
   * Present once older messages were rotated into segment files beside this
   * one (`conversation-archive.ts`): `messages` is then only the recent tail,
   * and this records what the segments hold. Absent on every conversation
   * that never outgrew the live-file budget — byte-identical to before.
   */
  archived?: ArchiveIndex;
  /**
   * What the chat's last finished routine run left its backend session
   * holding (session/routine-carry.ts). A top-level field, not a message, so
   * a rotation that archives that whole run cannot take it along: the next
   * run's routine budget reads it on the standing server and a pooled worker
   * alike.
   */
  routineCarry?: RoutineCarryRecord;
};

/** The context a routine run left its session holding, and how it ended. */
export interface RoutineCarryRecord {
  /** The run it describes. */
  turnId: string;
  /** Measured (else conservatively estimated) tokens; null when unknown. */
  tokens: number | null;
  /** The run ended in a context overflow. */
  overflowed: boolean;
  /** The window that overflow named, when the provider named one. */
  namedWindow: number | null;
}

/** A compaction summary waiting to be carried into the next prompt. */
export interface CompactionCheckpoint {
  summary: string;
  createdAt: number;
}
