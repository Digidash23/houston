import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { Agent, SkillSummary } from "../../lib/types";
import type { WorkspaceSkillRow } from "../../lib/workspace-skills";
import { type SkillChatIntent, SkillChatPane } from "./skill-chat-pane";

/**
 * The guided create chat, plus the editor's own chat, both on the employee
 * whose Skills section this is: a skill is built ON one AI Employee, and the
 * section already stands on it. {@link SkillChatPane} is keyed per open, so
 * every skill lands on its own conversation.
 */
export function useSkillCreateFlow(opts: {
  /** The employee whose Skills section this is. */
  agent: Agent;
  /** folderPath → every skill that employee RUNS: its own copies plus the
   *  workspace skills it loads. The chat resolves a skill by slug out of this,
   *  so the copies alone would strand a workspace skill's chat on "Opening". */
  skillsByPath: ReadonlyMap<string, SkillSummary[] | undefined>;
  /** Whether reading those skills failed — the chat stops waiting on a list
   *  that never lands. */
  skillsFailed: boolean;
  /** The chat's "Edit manually" — shows the skill's markdown on the left. */
  onEditSkill: (slug: string) => void;
}): {
  node: ReactNode;
  startChat: () => void;
  /** Reopen ONE unfinished creation chat, from the row the list draws for it. */
  openDraft: (activityId: string) => void;
  /** The editor's chat: the skill's own conversation, run by this employee,
   *  which loads the skill whether it keeps its own copy or the workspace's. */
  openForSkill: (row: WorkspaceSkillRow) => void;
  /** Unmount the chat — the shell panel closes with it. */
  close: () => void;
  /** Whether a chat is mounted right now (the panel is up). */
  open: boolean;
  /** The unclaimed chat the open pane holds, so the list never draws a second
   *  row for it. */
  openActivityId: string | null;
} {
  const { agent, skillsByPath, skillsFailed, onEditSkill } = opts;
  const [chat, setChat] = useState<{
    agent: Agent;
    initial: SkillChatIntent;
    nonce: number;
  } | null>(null);
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const nonceRef = useRef(0);

  const openChat = useCallback((agent: Agent, initial: SkillChatIntent) => {
    nonceRef.current += 1;
    setChat({ agent, initial, nonce: nonceRef.current });
  }, []);

  // The section lists this employee's unfinished chats, so a create may
  // resume one of them rather than start a stranger's conversation.
  const startChat = useCallback(
    () => openChat(agent, { kind: "create", allowResume: true }),
    [agent, openChat],
  );

  const openDraft = useCallback(
    (activityId: string) => openChat(agent, { kind: "draft", activityId }),
    [agent, openChat],
  );

  const openForSkill = useCallback(
    (row: WorkspaceSkillRow) =>
      openChat(agent, { kind: "skill", slug: row.slug }),
    [agent, openChat],
  );

  const close = useCallback(() => setChat(null), []);

  const node = chat ? (
    <SkillChatPane
      key={`${chat.agent.id}:${chat.nonce}`}
      agent={chat.agent}
      skills={skillsByPath.get(chat.agent.folderPath)}
      skillsFailed={skillsFailed}
      initial={chat.initial}
      onClose={close}
      onEditSkill={onEditSkill}
      onOpenActivityChange={setOpenActivityId}
    />
  ) : null;

  return {
    node,
    startChat,
    openDraft,
    openForSkill,
    close,
    open: chat !== null,
    openActivityId,
  };
}
