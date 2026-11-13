import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  coupons,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  RefundStatus,
  refunds,
  teamMembers,
  TeamMemberRole,
  UserRole,
  users,
} from "~/db/schema";
import { commentExcerpt } from "~/lib/comment-markdown.server";
import { formatPrice } from "~/lib/utils";
import {
  defaultKnockGateway,
  type KnockGateway,
  type KnockUser,
  type TriggerPayload,
} from "~/lib/knock-gateway.server";
import {
  idempotencyKey,
  type EmailOnlyKey,
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
type WorkflowKey = NotificationKey | EmailOnlyKey;

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

function logTriggerFailure(
  key: WorkflowKey,
  idempotency: string,
  error: unknown
) {
  console.error(
    `[notifications] trigger failed workflow=${key} idempotencyKey=${idempotency}:`,
    error
  );
}

// Runs a trigger's lookups and send. Never throws: any error is logged with
// the workflow and idempotency key.
async function guarded(
  key: WorkflowKey,
  rowId: number,
  run: () => Promise<void>
) {
  try {
    await run();
  } catch (error) {
    logTriggerFailure(key, idempotencyKey(key, rowId), error);
  }
}

function userById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

// Triggers a workflow, or does nothing when Knock isn't configured. Never
// throws: errors are logged with the workflow and idempotency key.
async function deliver(
  gateway: KnockGateway | null,
  key: WorkflowKey,
  idempotency: string,
  payload: TriggerPayload
) {
  if (!gateway) {
    console.warn(
      `[notifications] KNOCK_* env vars are not set; skipped ${idempotency}`
    );
    return;
  }

  try {
    await gateway.trigger(key, payload, idempotency);
  } catch (error) {
    logTriggerFailure(key, idempotency, error);
  }
}

async function send(
  gateway: KnockGateway | null,
  key: NotificationKey,
  rowId: number,
  actor: User,
  recipients: User[],
  data: Record<string, string>
) {
  const others = recipients.filter((user) => user.id !== actor.id);
  if (gateway && others.length === 0) return;

  await deliver(gateway, key, idempotencyKey(key, rowId), {
    recipients: others.map(toKnockUser),
    actor: toKnockUser(actor),
    data,
  });
}

export function lessonDiscussionUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}#discussion`;
}

// Discussion Reply: tells the Discussion Question's author that someone
// else replied. Later repliers in the thread are not notified (no follow).
export const notifyDiscussionReply: NotificationTrigger = (
  db,
  commentId,
  gateway = defaultKnockGateway()
) =>
  guarded("discussion-reply", commentId, async () => {
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
    const actor = userById(db, reply.userId);
    const asker = question ? userById(db, question.userId) : undefined;
    if (!place || !actor || !asker) return;

    await send(gateway, "discussion-reply", reply.id, actor, [asker], {
      course_title: place.courseTitle,
      lesson_title: place.lessonTitle,
      excerpt: commentExcerpt(reply.body),
      url: lessonDiscussionUrl(place.courseSlug, reply.lessonId),
    });
  });

// A Team Licence is a Purchase with Seats. Its Refund Requests are raised
// from /team; an Individual Purchase's from the course page or /settings.
function isTeamLicence(db: Db, purchaseId: number) {
  const seat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
  return seat !== undefined;
}

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
// decided that way, so a stray call can't announce the wrong decision. A
// decline links to where a new request can be raised: /team for a Team
// Licence, the course page otherwise.
function notifyRefundDecision(
  db: Db,
  key: "refund-request-approved" | "refund-request-declined",
  refundRequestId: number,
  gateway: KnockGateway | null
) {
  return guarded(key, refundRequestId, async () => {
    const row = db
      .select({
        status: refunds.status,
        decisionNote: refunds.decisionNote,
        decidedBy: refunds.resolvedByUserId,
        purchaseId: purchases.id,
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

    const actor = userById(db, row.decidedBy);
    const buyer = userById(db, row.buyerId);
    if (!actor || !buyer) return;

    await send(gateway, key, refundRequestId, actor, [buyer], {
      course_title: row.courseTitle,
      amount: formatPrice(row.amountPaid),
      purchased_on: purchaseDate(row.purchasedAt),
      decision_note: row.decisionNote ?? "",
      url: approved
        ? "/dashboard"
        : isTeamLicence(db, row.purchaseId)
          ? "/team"
          : `/courses/${row.courseSlug}`,
    });
  });
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

// The Refund Request with what its emails and rows show about it.
function refundRequestDetails(db: Db, refundRequestId: number) {
  const row = db
    .select({
      reason: refunds.reason,
      purchaseId: purchases.id,
      buyerId: purchases.userId,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundRequestId))
    .get();
  if (!row) return undefined;
  const buyer = userById(db, row.buyerId);
  if (!buyer) return undefined;
  return {
    ...row,
    buyer,
    data: {
      course_title: row.courseTitle,
      amount: formatPrice(row.amountPaid),
      purchased_on: purchaseDate(row.purchasedAt),
      reason: row.reason,
    },
  };
}

// New Open Refund Request: tells every Platform Admin except the buyer (a
// Platform Admin can buy too) that a Refund Request was raised. Sent whatever
// the request's status is now, so a row never changes after a decision.
// Call after raiseRefundRequest succeeds.
export const notifyRefundRequestOpened: NotificationTrigger = (
  db,
  refundRequestId,
  gateway = defaultKnockGateway()
) =>
  guarded("refund-request-opened", refundRequestId, async () => {
    const request = refundRequestDetails(db, refundRequestId);
    if (!request) return;

    const platformAdmins = db
      .select()
      .from(users)
      .where(eq(users.role, UserRole.Admin))
      .all();

    await send(
      gateway,
      "refund-request-opened",
      refundRequestId,
      request.buyer,
      platformAdmins,
      { ...request.data, url: "/admin/refunds" }
    );
  });

// "Refund requested" receipt: an email-only workflow (ADR 0015) that emails
// the buyer every time they raise a Refund Request. No actor (they caused it
// themselves), no feed entry, no Notification Preference. "View refund
// request" goes where the buyer raised it: /team for a Team Licence,
// /settings otherwise. Call after raiseRefundRequest succeeds.
export function sendRefundRequestedReceipt(
  db: Db,
  refundRequestId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
) {
  return guarded("refund-requested", refundRequestId, async () => {
    const request = refundRequestDetails(db, refundRequestId);
    if (!request) return;

    await deliver(
      gateway,
      "refund-requested",
      idempotencyKey("refund-requested", refundRequestId),
      {
        recipients: [toKnockUser(request.buyer)],
        data: {
          ...request.data,
          url: isTeamLicence(db, request.purchaseId) ? "/team" : "/settings",
        },
      }
    );
  });
}

// A raised Refund Request fires the New Open Refund Request Notification and
// the buyer's receipt.
export async function notifyRefundRequestRaised(
  db: Db,
  refundRequestId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
) {
  await notifyRefundRequestOpened(db, refundRequestId, gateway);
  await sendRefundRequestedReceipt(db, refundRequestId, gateway);
}

// New Discussion Question: tells the course's Instructor that someone else
// (a Student, or a Platform Admin) asked a question on one of its lessons.
export const notifyDiscussionQuestion: NotificationTrigger = (
  db,
  commentId,
  gateway = defaultKnockGateway()
) =>
  guarded("discussion-question", commentId, async () => {
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
    const actor = userById(db, question.userId);
    const instructor = place ? userById(db, place.instructorId) : undefined;
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
  });

// Seat claimed: tells every Team Admin of the Seat's team, except the
// claimer, that a Student claimed a Seat on their Team Licence. Seats count
// the Team Licence's Seats, leaving out refunded Unclaimed Seats (as /team does).
export const notifySeatClaimed: NotificationTrigger = (
  db,
  couponId,
  gateway = defaultKnockGateway()
) =>
  guarded("seat-claimed", couponId, async () => {
    const seat = db
      .select()
      .from(coupons)
      .where(eq(coupons.id, couponId))
      .get();
    if (!seat || seat.redeemedByUserId === null) return;

    const actor = userById(db, seat.redeemedByUserId);
    const course = db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, seat.courseId))
      .get();
    if (!actor || !course) return;

    const teamAdmins = db
      .select({ user: users })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(
        and(
          eq(teamMembers.teamId, seat.teamId),
          eq(teamMembers.role, TeamMemberRole.Admin)
        )
      )
      .all()
      .map((row) => row.user);

    const seats = db
      .select({ redeemedByUserId: coupons.redeemedByUserId })
      .from(coupons)
      .where(
        and(eq(coupons.purchaseId, seat.purchaseId), isNull(coupons.refundedAt))
      )
      .all();
    const seatsLeft = seats.filter((s) => s.redeemedByUserId === null).length;

    await send(gateway, "seat-claimed", seat.id, actor, teamAdmins, {
      course_title: course.title,
      seats_left: String(seatsLeft),
      seats_total: String(seats.length),
      url: "/team",
    });
  });

// New Enrollment: tells the course's Instructor about each new Enrollment,
// from an Individual Purchase or a Claimed Seat (a Lapsed Student enrolling
// again is a new Enrollment). Buying a Team Licence enrolls no one.
export const notifyNewEnrollment: NotificationTrigger = (
  db,
  enrollmentId,
  gateway = defaultKnockGateway()
) =>
  guarded("new-enrollment", enrollmentId, async () => {
    const enrollment = db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .get();
    if (!enrollment) return;

    const course = db
      .select()
      .from(courses)
      .where(eq(courses.id, enrollment.courseId))
      .get();
    const actor = userById(db, enrollment.userId);
    const instructor = course ? userById(db, course.instructorId) : undefined;
    if (!course || !actor || !instructor) return;

    await send(gateway, "new-enrollment", enrollment.id, actor, [instructor], {
      course_title: course.title,
      course_id: String(course.id),
      url: `/instructor/${course.id}/students`,
    });
  });

// A coupon redeem claims a Seat and creates an Enrollment, so it fires both.
export async function notifyCouponRedeemed(
  db: Db,
  couponId: number,
  enrollmentId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
) {
  await notifySeatClaimed(db, couponId, gateway);
  await notifyNewEnrollment(db, enrollmentId, gateway);
}

export const notificationTriggers = {
  "discussion-question": notifyDiscussionQuestion,
  "discussion-reply": notifyDiscussionReply,
  "seat-claimed": notifySeatClaimed,
  "new-enrollment": notifyNewEnrollment,
  "refund-request-approved": notifyRefundRequestApproved,
  "refund-request-declined": notifyRefundRequestDeclined,
  "refund-request-opened": notifyRefundRequestOpened,
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
