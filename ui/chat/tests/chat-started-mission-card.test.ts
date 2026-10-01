import { deepStrictEqual, match, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChatStartedMissionCard,
  startedMissions,
} from "../src/chat-started-mission-card.tsx";
import { feedItemsToMessages } from "../src/feed-to-messages.ts";
import type { TurnEndSummary } from "../src/turn-tools.ts";
import { computeTurnEndSummary } from "../src/turn-tools.ts";
import type { FeedItem } from "../src/types.ts";

const mission = { id: "m1", title: "Write the report", agent: "Ada" };
(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("started mission summary", () => {
  it("keeps mission receipts through the feed and gathers them under the final reply", () => {
    const feed: FeedItem[] = [
      { feed_type: "user_message", data: "Start two missions" },
      {
        feed_type: "tool_call",
        data: { name: "start_mission", input: { agent: "Ada" } },
      },
      {
        feed_type: "tool_result",
        data: { content: "", is_error: false, mission },
      },
      {
        feed_type: "tool_call",
        data: { name: "start_mission", input: { agent: "Ada" } },
      },
      {
        feed_type: "tool_result",
        data: {
          content: "",
          is_error: false,
          mission: { ...mission, id: "m2" },
        },
      },
      { feed_type: "assistant_text", data: "Both are underway" },
    ];
    const messages = feedItemsToMessages(feed);
    const summary = computeTurnEndSummary(messages, "ready").get(
      messages.length - 1,
    );
    strictEqual(summary !== undefined, true);
    deepStrictEqual(
      startedMissions(summary as TurnEndSummary).map((item) => item.id),
      ["m1", "m2"],
    );
  });
  it("selects every successful structured start and skips failures and old history", () => {
    const summary: TurnEndSummary = {
      fileChanges: [],
      tools: [
        {
          name: "start_mission",
          result: { content: "", is_error: false, mission },
        },
        {
          name: "start_mission",
          result: {
            content: "",
            is_error: true,
            mission: { ...mission, id: "failed" },
          },
        },
        {
          name: "start_mission",
          result: { content: "Started mission", is_error: false },
        },
        {
          name: "start_mission",
          result: {
            content: "",
            is_error: false,
            mission: { ...mission, id: "m2" },
          },
        },
        {
          name: "mcp__houston__start_mission",
          result: {
            content: "",
            is_error: false,
            mission: { ...mission, id: "m3" },
          },
        },
      ],
    };
    deepStrictEqual(
      startedMissions(summary).map((item) => item.id),
      ["m1", "m2", "m3"],
    );
  });

  it("renders the avatar, title and visible action", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatStartedMissionCard, {
        mission,
        agentName: "Ada",
        onOpen: () => {},
      }),
    );
    match(html, /Ada is on it/);
    match(html, /Write the report/);
    match(html, />Open</);
    match(html, /min-h-11/);
    strictEqual(html.includes('disabled=""'), false);
  });

  it("lets the host word the line around the name, in any language", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatStartedMissionCard, {
        mission,
        agentName: "Ada",
        onOpen: () => {},
        labels: {
          heading: (name: string) => `¡${name} ya está en ello!`,
          open: "Abrir",
          openMission: (title: string) => `Abrir ${title}`,
          unavailable: "Ya no está en tu equipo",
        },
      }),
    );
    match(html, /¡Ada ya está en ello!/);
    match(html, /aria-label="Abrir Write the report"/);
  });

  it("keeps the card and disables opening a deleted employee", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatStartedMissionCard, {
        mission,
        agentName: "Ada",
      }),
    );
    match(html, /No longer on your team/);
    match(html, /disabled=""/);
  });
});
