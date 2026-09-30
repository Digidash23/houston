/**
 * Whether a send is a message the person typed. Houston also writes messages
 * for them (their onboarding goal starting, its Try again), which carry
 * `sentForPerson`: those are never counted as the person's chat message, or
 * every onboarding with a goal would read as an activated user.
 */
export function isTypedSend(overrides: { sentForPerson?: true }): boolean {
  return overrides.sentForPerson !== true;
}
