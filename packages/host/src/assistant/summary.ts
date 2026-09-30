import type { ApprovalArg } from "@houston/protocol/approval";
import type { AssistantOperation } from "./catalog";
import { hireSummary } from "./hire-summary";

/**
 * What an approval card is ABOUT, authored HERE from the catalog and the exact
 * arguments the operation would run with, never by the model. That is the whole
 * point: a model that could author the question could describe a rename and
 * perform a delete, and the user would have approved the rename.
 *
 * It is authored in the HOST because the host is what issues the receipt the
 * approval becomes (`approvals.ts`) — one place decides both, so the thing a
 * person read and the bytes their yes authorizes can never drift apart.
 *
 * The account is STRUCTURAL ({@link ConfirmationSummary.args}): the host says
 * which operation and with which exact arguments, and the surface says it in
 * the reader's own language (`app/src/lib/interaction-approval-labels.ts`). A
 * sentence authored here could only ever be authored in one language, and a
 * person cannot approve what they cannot read. `title`/`detail` remain the
 * host's English rendering of the same structure, for text-only surfaces and
 * for any shell that has no wording of its own.
 *
 * Arguments are shown IN FULL, as labeled facts rather than JSON. A value the
 * user cannot see is a value they did not approve, and two different calls
 * never read the same: nested arguments become facts named by their path, a
 * long or multi-line value moves out of the sentence into its own block, and
 * the only case not shown whole ({@link VALUE_LIMIT}, or a list longer than
 * {@link LIST_LIMIT} items, which reads as one block) carries the exact
 * number of characters it left out. Hire instructions remain whole.
 */

/** Limit for general values; hire instructions remain whole. */
const VALUE_LIMIT = 2000;

/** The most list items shown as facts of their own. */
const LIST_LIMIT = 20;

/** What each kind of empty value reads as: no value, an empty list and an
 *  empty group are different calls, so they never read the same. */
const NOTHING = "none";
const EMPTY_LIST = "empty list";
const EMPTY_GROUP = "empty";
const PLACEHOLDERS = new Set([NOTHING, EMPTY_LIST, EMPTY_GROUP]);

/** The longest value that still reads inside a sentence. */
const INLINE_LIMIT = 80;

/** `agentPath` -> `agent path`: the argument named the way a person would. */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** One value as text. A string that reads as the empty placeholder, or as
 *  an already quoted one, is quoted (escaped), so it never reads like
 *  another value. */
function asText(value: unknown): string {
  if (value === null) return NOTHING;
  if (
    typeof value === "string" &&
    (PLACEHOLDERS.has(value.trim()) || /^\s*".*"\s*$/s.test(value))
  )
    return JSON.stringify(value);
  return String(value);
}

/** A nested key in a fact's path. A key holding the path's own separators
 *  (a dot, the space before a list position) or a quote is quoted, so two
 *  different nestings never share a name. */
function pathKey(key: string): string {
  return /[.\s"]/.test(key) ? JSON.stringify(key) : key;
}

/** The catalog's description, guaranteed to end a sentence. */
function asSentence(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** What one approval card says: the operation, the exact arguments it would run
 *  with, and the host's own English rendering of both. */
export interface ConfirmationSummary {
  /** One line, always present: what this call would do and what it affects. */
  title: string;
  /** The long or multi-line arguments, verbatim, each under its own label.
   *  Absent when every argument fits in the title. */
  detail?: string;
  /** Every argument the call would run with, in the order they were given. */
  args: ApprovalArg[];
}

/**
 * The readable facts of one exact call, as a card must show them.
 *
 * Derived from the SAME params the approval key is computed over
 * (`approvals.ts` issues both together), so the card and the receipt can never
 * describe two different calls. An `undefined` value is not an argument: it is
 * not sent, so it is not shown.
 */
export function approvalArgs(params: Record<string, unknown>): ApprovalArg[] {
  const args: ApprovalArg[] = [];
  const push = (name: string, text: string): void => {
    const long = text.length > INLINE_LIMIT || text.includes("\n");
    args.push(
      text.length <= VALUE_LIMIT || name === "seed.claudeMd"
        ? { name, value: text, long }
        : {
            name,
            value: text.slice(0, VALUE_LIMIT),
            long: true,
            truncated: text.length - VALUE_LIMIT,
          },
    );
  };
  const add = (name: string, value: unknown): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      if (value.length === 0) push(name, EMPTY_LIST);
      else if (value.length > LIST_LIMIT) push(name, listBlock(value));
      else
        for (const [index, item] of value.entries())
          add(`${name} ${index + 1}`, item);
      return;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) push(name, EMPTY_GROUP);
      for (const [key, child] of entries) add(`${name}.${pathKey(key)}`, child);
      return;
    }
    push(name, asText(value));
  };
  for (const [name, value] of Object.entries(params)) add(name, value);
  return args;
}

/** A list too long for a fact per item: one item per line. */
function listBlock(items: readonly unknown[]): string {
  return items
    .map((item) =>
      item !== null && typeof item === "object"
        ? JSON.stringify(item)
        : asText(item),
    )
    .join("\n");
}

/** The host's own English rendering of one argument's block. */
function englishBlock(arg: ApprovalArg): string {
  const cut =
    arg.truncated === undefined
      ? ""
      : `\n[and ${arg.truncated} more characters, all of which would be written]`;
  return `The exact ${humanize(arg.name)} is:\n${arg.value}${cut}`;
}

/**
 * The plain-language account of what this exact call would do: the operation's
 * own description, then every argument it would act on. No operation names, no
 * parameter syntax, nothing the user has to be technical to read.
 *
 * Short arguments read as one sentence ("This affects agent path
 * "Personal/Dobby""); anything long or multi-line moves to `detail`, so a
 * file's contents are read as contents rather than crammed into a sentence.
 */
export function confirmationSummary(
  op: AssistantOperation,
  params: Record<string, unknown>,
): ConfirmationSummary {
  const args = approvalArgs(params);
  if (op.name === "createAgent") return hireSummary(args);
  const sentence = asSentence(op.description);
  if (args.length === 0) return { title: sentence, args };

  const short = args.filter((arg) => !arg.long);
  const long = args.filter((arg) => arg.long);
  const phrase = short
    .map((arg) => `${humanize(arg.name)} "${arg.value}"`)
    .join(", ");
  const title =
    short.length > 0
      ? sentence
        ? `${sentence} This affects ${phrase}.`
        : `Affects ${phrase}.`
      : sentence;
  const detail = long.map(englishBlock).join("\n\n");
  return detail ? { title, detail, args } : { title, args };
}
