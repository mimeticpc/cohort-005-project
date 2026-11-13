import { describe, it, expect } from "vitest";
import {
  badgeLabel,
  feedRow,
  sentenceText,
  timeAgo,
} from "./notification-feed-rows";

describe("badgeLabel", () => {
  it("hides the badge when nothing is unseen", () => {
    expect(badgeLabel(0)).toBeNull();
  });

  it("shows the unseen count up to nine", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
  });

  it("caps at 9+ above nine", () => {
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(250)).toBe("9+");
  });
});

const replyItem = {
  source: { key: "discussion-reply" },
  actors: [
    { id: "2", name: "Sarah Chen", avatar: "https://img.example/sarah.png" },
  ],
  data: {
    course_title: "Intro to Cooking",
    lesson_title: "Knife Skills",
    excerpt: "Hold the blade at an angle.",
    url: "/courses/intro/lessons/3",
  },
  read_at: null,
};

describe("feedRow", () => {
  it("builds a Discussion Reply row from the send-time data", () => {
    expect(feedRow(replyItem)).toEqual({
      actorName: "Sarah Chen",
      avatarUrl: "https://img.example/sarah.png",
      sentence: [
        { text: "Sarah Chen", bold: true },
        { text: " replied to your question on " },
        { text: "Knife Skills", bold: true },
      ],
      excerpt: "Hold the blade at an angle.",
      ctaLabel: "View reply",
      target: "/courses/intro/lessons/3",
      unread: true,
    });
  });

  it("is read once Knock has a read_at", () => {
    expect(
      feedRow({ ...replyItem, read_at: "2026-11-12T10:00:00Z" })?.unread
    ).toBe(false);
  });

  it("falls back to 'Someone' with no avatar when the actor is missing", () => {
    const row = feedRow({ ...replyItem, actors: [] });
    expect(row?.actorName).toBe("Someone");
    expect(row?.avatarUrl).toBeNull();
    expect(row?.sentence[0]).toEqual({ text: "Someone", bold: true });
  });

  it("leaves out an empty excerpt", () => {
    const row = feedRow({
      ...replyItem,
      data: { ...replyItem.data, excerpt: "" },
    });
    expect(row?.excerpt).toBeNull();
  });

  it("skips Notifications Cadence doesn't know", () => {
    expect(
      feedRow({ ...replyItem, source: { key: "some-old-workflow" } })
    ).toBeNull();
  });
});

describe("feedRow for Refund Request decisions", () => {
  const decided = (key: string, decision_note: string, url: string) => ({
    source: { key },
    actors: [{ id: "9", name: "Pat Admin" }],
    data: {
      course_title: "Intro to Cooking",
      amount: "$79.00",
      purchased_on: "Oct 3, 2026",
      decision_note,
      url,
    },
    read_at: null,
  });

  it("tells the buyer it was approved, with the note, linking to the dashboard", () => {
    expect(
      feedRow(decided("refund-request-approved", "Enjoy!", "/dashboard"))
    ).toMatchObject({
      sentence: [
        { text: "Your Refund Request for " },
        { text: "Intro to Cooking", bold: true },
        { text: " was approved" },
      ],
      excerpt: "Enjoy!",
      ctaLabel: "View",
      target: "/dashboard",
    });
  });

  it("leaves out the note when the Platform Admin wrote none", () => {
    expect(
      feedRow(decided("refund-request-approved", "", "/dashboard"))?.excerpt
    ).toBeNull();
  });

  it("tells the buyer it was declined, with the note, linking to the course", () => {
    expect(
      feedRow(
        decided("refund-request-declined", "Past half way.", "/courses/intro")
      )
    ).toMatchObject({
      sentence: [
        { text: "Your Refund Request for " },
        { text: "Intro to Cooking", bold: true },
        { text: " was declined" },
      ],
      excerpt: "Past half way.",
      ctaLabel: "View course",
      target: "/courses/intro",
    });
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("says just now under a minute", () => {
    expect(timeAgo(ago(30_000), now)).toBe("just now");
  });

  it("spells out minutes, hours and days", () => {
    expect(timeAgo(ago(60_000), now)).toBe("1 minute ago");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(timeAgo(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(timeAgo(ago(3 * 60 * 60_000), now)).toBe("3 hours ago");
    expect(timeAgo(ago(24 * 60 * 60_000), now)).toBe("1 day ago");
    expect(timeAgo(ago(29 * 24 * 60 * 60_000), now)).toBe("29 days ago");
  });

  it("gives a date from 30 days on", () => {
    expect(timeAgo("2026-09-01T12:00:00Z", now)).toBe("Sep 1, 2026");
  });

  it("is empty for an unparseable time", () => {
    expect(timeAgo("not a date", now)).toBe("");
  });
});

describe("sentenceText", () => {
  it("joins the sentence as plain text", () => {
    expect(sentenceText(feedRow(replyItem)!.sentence)).toBe(
      "Sarah Chen replied to your question on Knife Skills"
    );
  });
});
