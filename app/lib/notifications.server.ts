import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { purchases, RefundStatus, refunds } from "~/db/schema";
import { commentExcerpt } from "~/lib/comment-markdown.server";
import { formatPrice } from "~/lib/utils";
import {
  defaultKnockGateway,
  type KnockGateway,
  type KnockUser,
} from "~/lib/knock-gateway.server";
import {
  idempotencyKey,
  type NotificationKey,
} from "~/lib/notification-catalogue";

// ─── Notification triggers ───
// One function per Notification in the catalogue, each taking the database,
// the id of the row that caused it, and the KnockGateway (defaulting to the
// real one). Call them after the domain write has committed, never inside
// db.transaction. They never throw: a Notification problem must not fail
// the action that caused it.
//
// Each trigger looks up its recipients, removes the actor, inline-identifies
// recipients and actor, and sends `<prefix>:<row id>` as the idempotency key.

type Db = BetterSQLite3Database<typeof schema>;
type User = typeof users.$inferSelect;

export type NotificationTrigger = (
  db: Db,
  rowId: number,
  gateway?: KnockGateway | null
) => Promise<void>;

export function toKnockUser(user: User): KnockUser {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    ...(user.avatarUrl ? { avatar: user.avatarUrl } : {}),
  };
}

async function send(
  gateway: KnockGateway | null,
  key: NotificationKey,
  rowId: number,
  actor: User,
  recipients: User[],
  data: Record<string, string>
) {
  const idempotency = idempotencyKey(key, rowId);
  if (!gateway) {
    console.warn(
      `[notifications] KNOCK_* env vars are not set; skipped ${idempotency}`
    );
    return;
  }

  const others = recipients.filter((user) => user.id !== actor.id);
  if (others.length === 0) return;

  try {
    await gateway.trigger(
      key,
      {
        recipients: others.map(toKnockUser),
        actor: toKnockUser(actor),
        data,
      },
      idempotency
    );
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=${key} idempotencyKey=${idempotency}:`,
      error
    );
  }
}

export function lessonDiscussionUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}#discussion`;
}

// Discussion Reply: tells the Discussion Question's author that someone
// else replied. Later repliers in the thread are not notified (no follow).
export const notifyDiscussionReply: NotificationTrigger = async (
  db,
  commentId,
  gateway = defaultKnockGateway()
) => {
  try {
    const reply = db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .get();
    if (!reply || reply.parentId === null) return;

    const question = db
      .select()
      .from(comments)
      .where(eq(comments.id, reply.parentId))
      .get();
    const place = db
      .select({
        lessonTitle: lessons.title,
        courseTitle: courses.title,
        courseSlug: courses.slug,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, reply.lessonId))
      .get();
    const actor = db
      .select()
      .from(users)
      .where(eq(users.id, reply.userId))
      .get();
    const asker = question
      ? db.select().from(users).where(eq(users.id, question.userId)).get()
      : undefined;
    if (!place || !actor || !asker) return;

    await send(gateway, "discussion-reply", reply.id, actor, [asker], {
      course_title: place.courseTitle,
      lesson_title: place.lessonTitle,
      excerpt: commentExcerpt(reply.body),
      url: lessonDiscussionUrl(place.courseSlug, reply.lessonId),
    });
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=discussion-reply idempotencyKey=${idempotencyKey("discussion-reply", commentId)}:`,
      error
    );
  }
};

// "Oct 3, 2026", in the server's local calendar like the refund window.
function purchaseDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Refund Request approved / declined: tells the buyer (purchases.userId —
// the Student, or the Team Admin who bought a Team Licence) that a Platform
// Admin decided their Refund Request. Does nothing unless the request was
// decided that way, so a stray call can't announce the wrong decision.
async function notifyRefundDecision(
  db: Db,
  key: "refund-request-approved" | "refund-request-declined",
  refundRequestId: number,
  gateway: KnockGateway | null
) {
  try {
    const row = db
      .select({
        status: refunds.status,
        decisionNote: refunds.decisionNote,
        decidedBy: refunds.resolvedByUserId,
        buyerId: purchases.userId,
        amountPaid: purchases.amountPaid,
        purchasedAt: purchases.createdAt,
        courseTitle: courses.title,
        courseSlug: courses.slug,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(eq(refunds.id, refundRequestId))
      .get();
    const approved = key === "refund-request-approved";
    const expected = approved ? RefundStatus.Approved : RefundStatus.Declined;
    if (!row || row.status !== expected || row.decidedBy === null) return;

    const actor = db
      .select()
      .from(users)
      .where(eq(users.id, row.decidedBy))
      .get();
    const buyer = db
      .select()
      .from(users)
      .where(eq(users.id, row.buyerId))
      .get();
    if (!actor || !buyer) return;

    await send(gateway, key, refundRequestId, actor, [buyer], {
      course_title: row.courseTitle,
      amount: formatPrice(row.amountPaid),
      purchased_on: purchaseDate(row.purchasedAt),
      decision_note: row.decisionNote ?? "",
      url: approved ? "/dashboard" : `/courses/${row.courseSlug}`,
    });
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=${key} idempotencyKey=${idempotencyKey(key, refundRequestId)}:`,
      error
    );
  }
}

// Call after approveRefundRequest succeeds, outside its transaction.
export const notifyRefundRequestApproved: NotificationTrigger = (
  db,
  refundRequestId,
  gateway = defaultKnockGateway()
) =>
  notifyRefundDecision(db, "refund-request-approved", refundRequestId, gateway);

// Call after declineRefundRequest succeeds, outside its transaction.
export const notifyRefundRequestDeclined: NotificationTrigger = (
  db,
  refundRequestId,
  gateway = defaultKnockGateway()
) =>
  notifyRefundDecision(db, "refund-request-declined", refundRequestId, gateway);

// New Discussion Question: tells the course's Instructor that someone else
// (a Student, or a Platform Admin) asked a question on one of its lessons.
export const notifyDiscussionQuestion: NotificationTrigger = async (
  db,
  commentId,
  gateway = defaultKnockGateway()
) => {
  try {
    const question = db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .get();
    if (!question || question.parentId !== null) return;

    const place = db
      .select({
        lessonTitle: lessons.title,
        courseTitle: courses.title,
        instructorId: courses.instructorId,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, question.lessonId))
      .get();
    const actor = db
      .select()
      .from(users)
      .where(eq(users.id, question.userId))
      .get();
    const instructor = place
      ? db.select().from(users).where(eq(users.id, place.instructorId)).get()
      : undefined;
    if (!place || !actor || !instructor) return;

    await send(
      gateway,
      "discussion-question",
      question.id,
      actor,
      [instructor],
      {
        course_title: place.courseTitle,
        lesson_title: place.lessonTitle,
        excerpt: commentExcerpt(question.body),
        url: "/instructor/questions",
      }
    );
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=discussion-question idempotencyKey=${idempotencyKey("discussion-question", commentId)}:`,
      error
    );
  }
};

export const notificationTriggers = {
  "discussion-question": notifyDiscussionQuestion,
  "discussion-reply": notifyDiscussionReply,
  "refund-request-approved": notifyRefundRequestApproved,
  "refund-request-declined": notifyRefundRequestDeclined,
} satisfies Record<NotificationKey, NotificationTrigger>;

// ─── Notification Feed config ───
// What the browser needs to poll the session user's feed: public key, feed
// channel and a signed RS256 user token. Signing is local (no network call),
// so the layout loader can call this per request; it follows the DevUI user
// switcher because the loader re-runs. Null when Knock isn't configured or
// signing fails — the bell then shows "Couldn't load Notifications".

export type FeedConfig = {
  knockUserId: string;
  publicApiKey: string;
  feedChannelId: string;
  userToken: string;
};

export async function getFeedConfig(
  userId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
): Promise<FeedConfig | null> {
  if (!gateway) return null;
  try {
    const knockUserId = String(userId);
    return {
      knockUserId,
      publicApiKey: gateway.feed.publicApiKey,
      feedChannelId: gateway.feed.channelId,
      userToken: await gateway.signUserToken(knockUserId),
    };
  } catch (error) {
    console.error("[notifications] could not sign a Knock user token:", error);
    return null;
  }
}
