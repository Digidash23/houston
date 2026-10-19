/**
 * Most characters of the turn's visible text the nudge quotes back. A turn
 * that wrote more than this before an offer is rare; past it the head is cut,
 * since the newest text is what the closing message continues from.
 */
const QUOTE_LIMIT = 6000;

const SCREEN =
  "The user never sees your reasoning or tool results, from this turn or earlier ones. Your visible messages from earlier turns are still on their screen.";

const WRITE_IT_OUT =
  "Anything you found or prepared for them that exists only in your reasoning or tool results (an answer, a link, a draft, findings) is not 'above' or 'earlier': write it out in full in your closing message.";

/**
 * What an offer tool tells a model that called it before writing a closing
 * message, about what the person has actually read this turn.
 *
 * The turn's visible text is quoted back verbatim instead of asking the model
 * to judge "if you already wrote it earlier in this turn". A model that put
 * its answer in its reasoning, or only saw the answer in a tool result,
 * judged that it had already written it, and replied "The link is in my reply
 * above" under a reply with no link.
 */
export function unreadReplyInstruction(visibleText: string): string {
  const seen = visibleText.trim();
  if (!seen)
    return `${SCREEN} So far this turn they have read nothing from you. ${WRITE_IT_OUT}`;
  const chars = Array.from(seen);
  if (chars.length <= QUOTE_LIMIT)
    return `${SCREEN} What they have read from you this turn is quoted here, verbatim:\n<read_by_user>\n${seen}\n</read_by_user>\nDo not repeat it. ${WRITE_IT_OUT}`;
  // Cut by code points: a lone surrogate in a tool result is a 400 from the
  // provider, and the Claude backend would keep it in the resumed session.
  const tail = chars.slice(-QUOTE_LIMIT).join("");
  return `${SCREEN} This turn they have read a long reply from you; its end is quoted here, verbatim:\n<read_by_user>\n[...] ${tail}\n</read_by_user>\nDo not repeat any of it, including the earlier part cut at [...]. ${WRITE_IT_OUT}`;
}
