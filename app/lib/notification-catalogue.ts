import { UserRole } from "~/db/schema";

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

// A feed row's trigger `data`, as Knock hands it back to the browser.
export type NotificationData = Record<string, unknown>;

export type NotificationEntry<Key extends string = string> = {
  key: Key;
  name: string;
  // Who receives it, in glossary terms.
  recipient: string;
  defaults: Partial<Record<ChannelType, boolean>>;
  ctaLabel: string;
  // Where the feed row and its CTA go, built from the trigger `data`. Null
  // when the data carries no usable in-app path.
  target: (data: NotificationData) => string | null;
  idempotencyKeyPrefix: string;
  // Whether /settings shows this row to the viewer.
  visibleTo: (viewer: Viewer) => boolean;
};

const everyone = () => true;
// Buyers who can raise a Refund Request: Students (and the Team Admins
// among them, who buy Team Licences). Compared as a string so this module
// stays free of the schema's runtime code (it ships to the browser).
const buyers = (viewer: Viewer) => `${viewer.role}` === "student";
const platformAdmins = (viewer: Viewer) => `${viewer.role}` === "admin";

// Only same-origin paths: "/x", never "//host" or "https://…".
function appPath(value: unknown): string | null {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : null;
}

function instructorStudentsPath(courseId: unknown): string | null {
  return typeof courseId === "string" && /^\d+$/.test(courseId)
    ? `/instructor/${courseId}/students`
    : null;
}

export const notificationCatalogue = {
  "discussion-question": {
    key: "discussion-question",
    name: "New Discussion Question",
    recipient: "The course's Instructor",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "Answer",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "discussion-question",
    visibleTo: (viewer) => viewer.role === UserRole.Instructor,
  },
  "discussion-reply": {
    key: "discussion-reply",
    name: "Discussion Reply",
    recipient: "The Discussion Question's author",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "View reply",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "discussion-reply",
    visibleTo: everyone,
  },
  "seat-claimed": {
    key: "seat-claimed",
    name: "Seat claimed",
    recipient: "The team's Team Admins, except the claimer",
    defaults: { in_app_feed: true, email: false },
    ctaLabel: "View team",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "seat-claimed",
    visibleTo: (viewer) => viewer.isTeamAdmin,
  },
  "new-enrollment": {
    key: "new-enrollment",
    name: "New Enrollment",
    recipient: "The course's Instructor",
    defaults: { in_app_feed: false, email: false },
    ctaLabel: "See students",
    target: (data) => instructorStudentsPath(data.course_id),
    idempotencyKeyPrefix: "enrollment-created",
    visibleTo: (viewer) => viewer.role === UserRole.Instructor,
  },
  // A Refund Request is decided once, so approved and declined share the
  // idempotency-key prefix. They are separate workflows so each has its own
  // Notification Preference row.
  "refund-request-approved": {
    key: "refund-request-approved",
    name: "Refund Request approved",
    recipient: "The buyer (the Student, or the Team Admin for a Team Licence)",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "View",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "refund-request-decided",
    visibleTo: buyers,
  },
  "refund-request-declined": {
    key: "refund-request-declined",
    name: "Refund Request declined",
    recipient: "The buyer (the Student, or the Team Admin for a Team Licence)",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "View course",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "refund-request-decided",
    visibleTo: buyers,
  },
  "refund-request-opened": {
    key: "refund-request-opened",
    name: "New Open Refund Request",
    recipient: "Every Platform Admin, except the one who raised it",
    defaults: { in_app_feed: true, email: true },
    ctaLabel: "Review",
    target: (data) => appPath(data.url),
    idempotencyKeyPrefix: "refund-request-opened",
    visibleTo: platformAdmins,
  },
} as const satisfies { [K in string]: NotificationEntry<K> };

export type NotificationKey = keyof typeof notificationCatalogue;

// ─── Email-only workflows (ADR 0015) ───
// Email the recipient caused themselves. Not Notifications: no feed step, no
// category, no Notification Preference, so never in the catalogue above and
// never in environmentDefaults(). They always send.
export type EmailOnlyWorkflow<Key extends string = string> = {
  key: Key;
  name: string;
  recipient: string;
  ctaLabel: string;
  idempotencyKeyPrefix: string;
};

export const emailOnlyWorkflows = {
  "refund-requested": {
    key: "refund-requested",
    name: "Refund requested receipt",
    recipient: "The buyer who raised the Refund Request",
    ctaLabel: "View refund request",
    idempotencyKeyPrefix: "refund-requested",
  },
} as const satisfies { [K in string]: EmailOnlyWorkflow<K> };

export type EmailOnlyKey = keyof typeof emailOnlyWorkflows;

const entries: NotificationEntry<NotificationKey>[] = Object.values(
  notificationCatalogue
);

export function visibleNotifications(viewer: Viewer) {
  return entries.filter((entry) => entry.visibleTo(viewer));
}

export function idempotencyKey(
  key: NotificationKey | EmailOnlyKey,
  rowId: number
) {
  const entry =
    key in emailOnlyWorkflows
      ? emailOnlyWorkflows[key as EmailOnlyKey]
      : notificationCatalogue[key as NotificationKey];
  return `${entry.idempotencyKeyPrefix}:${rowId}`;
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
