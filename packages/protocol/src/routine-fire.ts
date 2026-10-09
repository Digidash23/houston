/**
 * Marks the message request a routine run sends to a standing runtime. Only
 * the host's own `fireTurn` sets it: the host forwards a client's request to
 * the runtime with a header list it builds itself (proxy/route.ts `forward`),
 * so a client cannot make a message carry it.
 *
 * The runtime exempts a marked message from the rule that only the person a
 * live card is for may answer it: a routine's runs share one conversation and
 * act as different people (the creator on schedule, whoever clicked "run now"),
 * so a card one run left must not stop the next.
 */
export const ROUTINE_FIRE_HEADER = "x-houston-routine-fire";
