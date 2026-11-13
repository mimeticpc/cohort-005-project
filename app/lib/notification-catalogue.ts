import type { UserRole } from "~/db/schema";

// ─── Notification catalogue ───
// The only source of truth for which Notifications Cadence sends (ADR 0013).
// Each entry is keyed by its Knock workflow key. `npm run knock:sync` writes
// the per-channel defaults below to the Knock environment, the trigger
// functions in notifications.server.ts use the key and idempotency-key prefix,
// and /settings uses the role filter.
//
// Pure: no Knock SDK, no database.

// Knock channel types. A channel present in `defaults` is one the workflow
// sends on; its value is the default when the person has no stored entry.
export type ChannelType = "in_app_feed" | "email";

export type Viewer = { role: UserRole; isTeamAdmin: boolean };

export type NotificationEntry<Key extends string = string> = {
  key: Key;
  name: string;
  // Who receives it, in glossary terms.
  recipient: string;
  defaults: Partial<Record<ChannelType, boolean>>;
  ctaLabel: string;
  idempotencyKeyPrefix: string;
  // Whether /settings shows this row to the viewer.
  visibleTo: (viewer: Viewer) => boolean;
};

const everyone = () => true;

export const notificationCatalogue = {
  "discussion-reply": {
    key: "discussion-reply",
    name: "Discussion Reply",
    recipient: "The Discussion Question's author",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "View reply",
    idempotencyKeyPrefix: "discussion-reply",
    visibleTo: everyone,
  },
} as const satisfies { [K in string]: NotificationEntry<K> };

export type NotificationKey = keyof typeof notificationCatalogue;

const entries: NotificationEntry<NotificationKey>[] = Object.values(
  notificationCatalogue
);

export function visibleNotifications(viewer: Viewer) {
  return entries.filter((entry) => entry.visibleTo(viewer));
}

export function idempotencyKey(key: NotificationKey, rowId: number) {
  return `${notificationCatalogue[key].idempotencyKeyPrefix}:${rowId}`;
}

// The Knock environment's default PreferenceSet. Written in full by
// `npm run knock:sync` (the Management API PUT replaces the whole set), at
// workflow × channel_types level only — never categories.
export function environmentDefaults() {
  return {
    workflows: Object.fromEntries(
      entries.map((entry) => [
        entry.key,
        { channel_types: { ...entry.defaults } },
      ])
    ),
  };
}
