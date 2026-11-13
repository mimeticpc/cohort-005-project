import {
  notificationCatalogue,
  type NotificationData,
  type NotificationKey,
} from "~/lib/notification-catalogue";

// ─── Notification Feed rows ───
// Pure helpers behind the bell popover (app/components/notification-feed.tsx).
// Row copy is Cadence's, built from the trigger `data` that Knock stored at
// send time (so later renames don't rewrite history), keyed by workflow key.
// Knock's feed templates are not rendered. Safe for the browser bundle: no
// Knock SDK, no database.

// The bell's badge: the unseen count, capped at "9+"; null hides the badge.
export function badgeLabel(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

// "5 minutes ago" style; a date from 30 days on.
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed)) return "";
  if (elapsed < 60_000) return "just now";

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, "day");

  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// One run of the row sentence; the course or lesson title is bold.
export type SentencePart = { text: string; bold?: true };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const rowSentence: Record<
  NotificationKey,
  (actor: string, data: NotificationData) => SentencePart[]
> = {
  "discussion-question": (actor, data) => [
    { text: actor, bold: true },
    { text: " asked a question on " },
    { text: text(data.lesson_title), bold: true },
  ],
  "discussion-reply": (actor, data) => [
    { text: actor, bold: true },
    { text: " replied to your question on " },
    { text: text(data.lesson_title), bold: true },
  ],
};

export function sentenceText(sentence: SentencePart[]): string {
  return sentence.map((part) => part.text).join("");
}

// The subset of a Knock FeedItem a row needs.
export type FeedItemLike = {
  source: { key: string };
  actors: ReadonlyArray<object>;
  data: NotificationData | null;
  read_at: string | null;
};

export type FeedRow = {
  actorName: string;
  avatarUrl: string | null;
  sentence: SentencePart[];
  excerpt: string | null;
  ctaLabel: string;
  target: string | null;
  unread: boolean;
};

function isKnownKey(key: string): key is NotificationKey {
  return Object.hasOwn(notificationCatalogue, key);
}

function stringProp(value: object | undefined, prop: string): string | null {
  if (!value || !(prop in value)) return null;
  const found = (value as Record<string, unknown>)[prop];
  return typeof found === "string" && found !== "" ? found : null;
}

// Null for a workflow Cadence no longer knows: the row is skipped.
export function feedRow(item: FeedItemLike): FeedRow | null {
  const key = item.source.key;
  if (!isKnownKey(key)) return null;
  const entry = notificationCatalogue[key];
  const data = item.data ?? {};
  const actor = item.actors[0];
  const actorName = stringProp(actor, "name") ?? "Someone";

  return {
    actorName,
    avatarUrl: stringProp(actor, "avatar"),
    sentence: rowSentence[key](actorName, data),
    excerpt: text(data.excerpt) || null,
    ctaLabel: entry.ctaLabel,
    target: entry.target(data),
    unread: !item.read_at,
  };
}
