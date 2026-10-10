/**
 * The folder, directly under an agent's directory, where everything people send
 * it lands: composer attachments and files arriving over Slack or WhatsApp all
 * go through the host's upload route (packages/host/src/turn/attachments.ts).
 *
 * In DOMAIN because both sides must agree on it and neither owns the other: the
 * host writes there, and the runtime's file wall opens it to the coordinator,
 * which may read nothing else in its directory but its memory
 * (packages/runtime/src/session/coordinator-policy.ts). A rename on one side
 * alone would leave the coordinator unable to read a single attachment.
 */
export const UPLOADS_DIR = "uploads";
