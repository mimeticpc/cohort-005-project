import type {
  ChannelTypePreferences,
  KnockGateway,
  KnockUser,
} from "../app/lib/knock-gateway.server";
import {
  notificationCatalogue,
  type EmailOnlyKey,
  type NotificationKey,
} from "../app/lib/notification-catalogue";

// ─── knock:smoke messages ───
// Fixed sample trigger data for every catalogue Notification and every
// email-only workflow, sent straight through the KnockGateway: no database,
// no trigger functions. Each `data` must satisfy the workflow's
// trigger_data_json_schema in knock/workflows/<key>/workflow.json (Knock
// answers 422 otherwise) and mirror what app/lib/notifications.server.ts
// sends; knock-smoke-messages.test.ts checks the schema half.

export type SmokeRecipient = KnockUser;

// Someone other than the dev, so feed rows and emails read as they do for
// real ("Sam Smoke replied…"). Knock creates this user on the first run.
const smokeActor: KnockUser = {
  id: "knock-smoke-actor",
  name: "Sam Smoke",
  email: "knock-smoke-actor@example.com",
};

const course = "Smoke Testing 101";
const lesson = "Lighting the fuse";
const purchase = { amount: "$49.00", purchased_on: "12 Nov 2026" };

type SmokeMessage = { data: Record<string, string> };

export const smokeMessages = {
  "discussion-question": {
    data: {
      course_title: course,
      lesson_title: lesson,
      excerpt: "Does the fuse need to be lit from both ends?",
      url: "/instructor/questions",
    },
  },
  "discussion-reply": {
    data: {
      course_title: course,
      lesson_title: lesson,
      excerpt: "One end is plenty. Stand well back.",
      url: "/courses/smoke-testing-101/lessons/1#discussion",
    },
  },
  "seat-claimed": {
    data: {
      course_title: course,
      seats_left: "3",
      seats_total: "5",
      url: "/team",
    },
  },
  "new-enrollment": {
    data: {
      course_title: course,
      course_id: "1",
      url: "/instructor/1/students",
    },
  },
  "refund-request-approved": {
    data: {
      course_title: course,
      ...purchase,
      decision_note: "Approved: sorry it wasn't a fit.",
      url: "/dashboard",
    },
  },
  "refund-request-declined": {
    data: {
      course_title: course,
      ...purchase,
      decision_note: "Declined: the refund window has closed.",
      url: "/courses/smoke-testing-101",
    },
  },
  "refund-request-opened": {
    data: {
      course_title: course,
      ...purchase,
      reason: "Bought the wrong course.",
      url: "/admin/refunds",
    },
  },
  "refund-requested": {
    data: {
      course_title: course,
      ...purchase,
      reason: "Bought the wrong course.",
      url: "/settings",
    },
  },
} as const satisfies Record<NotificationKey | EmailOnlyKey, SmokeMessage>;

type SmokeKey = keyof typeof smokeMessages;

function isNotification(key: SmokeKey): key is NotificationKey {
  return key in notificationCatalogue;
}

// Every channel of every Notification on, so default-off ones (New
// Enrollment, Seat claimed email) arrive too. Email-only workflows have no
// preference.
function allChannelsOn() {
  return Object.fromEntries(
    Object.values(notificationCatalogue).map((entry) => {
      const channelTypes: ChannelTypePreferences = {};
      for (const type of Object.keys(
        entry.defaults
      ) as (keyof ChannelTypePreferences)[]) {
        channelTypes[type] = true;
      }
      return [entry.key, { channel_types: channelTypes }];
    })
  );
}

// Sends all eight messages to `recipient`. `runId` is `smoke:<timestamp>`;
// each trigger's idempotency key is `<runId>:<workflow key>`, so a rerun
// sends again while a retry within one run doesn't double up. Returns the
// workflow keys sent, in order.
export async function sendSmokeMessages(
  gateway: KnockGateway,
  recipient: SmokeRecipient,
  runId: string
): Promise<SmokeKey[]> {
  await gateway.mergePreferences(recipient.id, allChannelsOn());

  const keys = Object.keys(smokeMessages) as SmokeKey[];
  for (const key of keys) {
    await gateway.trigger(
      key,
      {
        recipients: [recipient],
        ...(isNotification(key) ? { actor: smokeActor } : {}),
        data: { ...smokeMessages[key].data },
      },
      `${runId}:${key}`
    );
  }
  return keys;
}
