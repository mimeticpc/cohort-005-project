import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "~/db/schema";
import {
  RefundRequestStatus,
  RefundStatus,
  coupons,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  refundRequests,
  refunds,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// Refund Requests and Refunds — see GLOSSARY.md (Refunds) and
// docs/adr/0001-refund-separate-from-request.md.
//
// Every function takes the database as its first argument so tests can pass an
// in-memory one. Uses positional parameters (project convention).

export type Database = BetterSQLite3Database<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | Transaction;

/** Watching this much of a Course rules out a Refund Request. */
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;

/**
 * Seconds of the Course's video the Learner has watched, across every
 * Purchase of it: the furthest position reached in each lesson, summed.
 */
export function getSecondsWatched(
  database: Queryable,
  userId: number,
  courseId: number
) {
  const lessonIds = database
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = database
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

/** A claimed team seat belongs to the team; the buyer cannot hand it back. */
export function hasClaimedSeat(database: Queryable, purchaseId: number) {
  const claimed = database
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return !!claimed;
}

/**
 * The Learner's Approved Refund Request for this Course, if they have one.
 * A Learner gets at most one Refund per Course, across all their Purchases.
 */
export function findApprovedRefundRequestForCourse(
  database: Queryable,
  userId: number,
  courseId: number
) {
  return database
    .select({
      id: refundRequests.id,
      resolvedAt: refundRequests.resolvedAt,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refundRequests.status, RefundRequestStatus.Approved)
      )
    )
    .get();
}

const resolvers = alias(users, "resolvers");

/**
 * Refund Requests in one state, for the Admin screen. Open ones come oldest
 * first (the queue); resolved ones come most recently resolved first.
 */
export function listRefundRequestsForAdmin(
  database: Database,
  status: RefundRequestStatus
) {
  const rows = database
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      requestedAt: refundRequests.requestedAt,
      resolvedAt: refundRequests.resolvedAt,
      resolvedByName: resolvers.name,
      purchaseId: purchases.id,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      refundStatus: refunds.status,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(resolvers, eq(refundRequests.resolvedByUserId, resolvers.id))
    .leftJoin(refunds, eq(refunds.refundRequestId, refundRequests.id))
    .where(eq(refundRequests.status, status))
    .orderBy(
      status === RefundRequestStatus.Open
        ? asc(refundRequests.requestedAt)
        : desc(refundRequests.resolvedAt)
    )
    .all();

  return rows.map((row) => {
    const watchedSeconds = getSecondsWatched(
      database,
      row.learnerId,
      row.courseId
    );
    return {
      ...row,
      watchedSeconds,
      watchedOverLimit: watchedSeconds >= REFUND_WATCH_LIMIT_SECONDS,
      seatClaimed: hasClaimedSeat(database, row.purchaseId),
    };
  });
}

/** The Learner's own Refund Requests, newest first, optionally in one state. */
export function listRefundRequestsForLearner(
  database: Database,
  userId: number,
  status: RefundRequestStatus | null
) {
  return database
    .select({
      id: refundRequests.id,
      status: refundRequests.status,
      reason: refundRequests.reason,
      requestedAt: refundRequests.requestedAt,
      resolvedAt: refundRequests.resolvedAt,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      refundStatus: refunds.status,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(refunds, eq(refunds.refundRequestId, refundRequests.id))
    .where(
      and(
        eq(purchases.userId, userId),
        status ? eq(refundRequests.status, status) : undefined
      )
    )
    .orderBy(desc(refundRequests.requestedAt))
    .all();
}

export type RefundRequestDecision = "approve" | "decline";

export type ResolveResult =
  | {
      outcome: "resolved";
      status: RefundRequestStatus.Approved | RefundRequestStatus.Declined;
      learnerName: string;
      learnerEmail: string;
      courseTitle: string;
      amount: number;
    }
  | { outcome: "not-found" }
  | {
      outcome: "already-resolved";
      status: RefundRequestStatus;
      resolvedByName: string | null;
    }
  | { outcome: "seat-claimed" };

/**
 * An Admin Resolves an Open Refund Request. A resolution is final: the first
 * one wins and any later attempt reports "already-resolved".
 *
 * Approving creates the Refund (Pending, for the full amount paid) and Ends the
 * Learner's Enrollment, in one transaction. A claimed team seat blocks
 * approval; watching past the limit does not (the Admin is warned instead).
 */
export function resolveRefundRequest(
  database: Database,
  refundRequestId: number,
  adminId: number,
  decision: RefundRequestDecision
): ResolveResult {
  return database.transaction((tx): ResolveResult => {
    const request = tx
      .select({
        id: refundRequests.id,
        status: refundRequests.status,
        resolvedByName: resolvers.name,
        purchaseId: purchases.id,
        amountPaid: purchases.amountPaid,
        learnerId: users.id,
        learnerName: users.name,
        learnerEmail: users.email,
        courseId: courses.id,
        courseTitle: courses.title,
      })
      .from(refundRequests)
      .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .leftJoin(resolvers, eq(refundRequests.resolvedByUserId, resolvers.id))
      .where(eq(refundRequests.id, refundRequestId))
      .get();

    if (!request) return { outcome: "not-found" };

    if (request.status !== RefundRequestStatus.Open) {
      return {
        outcome: "already-resolved",
        status: request.status,
        resolvedByName: request.resolvedByName,
      };
    }

    if (decision === "approve" && hasClaimedSeat(tx, request.purchaseId)) {
      return { outcome: "seat-claimed" };
    }

    const status =
      decision === "approve"
        ? RefundRequestStatus.Approved
        : RefundRequestStatus.Declined;
    const now = new Date().toISOString();

    // The status condition is what makes the first resolution win.
    const resolved = tx
      .update(refundRequests)
      .set({ status, resolvedAt: now, resolvedByUserId: adminId })
      .where(
        and(
          eq(refundRequests.id, refundRequestId),
          eq(refundRequests.status, RefundRequestStatus.Open)
        )
      )
      .returning({ id: refundRequests.id })
      .get();

    if (!resolved) {
      return {
        outcome: "already-resolved",
        status: request.status,
        resolvedByName: request.resolvedByName,
      };
    }

    if (status === RefundRequestStatus.Approved) {
      tx.insert(refunds)
        .values({
          refundRequestId,
          amount: request.amountPaid,
          status: RefundStatus.Pending,
          createdAt: now,
        })
        .run();

      tx.update(enrollments)
        .set({ endedAt: now })
        .where(
          and(
            eq(enrollments.userId, request.learnerId),
            eq(enrollments.courseId, request.courseId),
            isNull(enrollments.endedAt)
          )
        )
        .run();
    }

    return {
      outcome: "resolved",
      status,
      learnerName: request.learnerName,
      learnerEmail: request.learnerEmail,
      courseTitle: request.courseTitle,
      amount: request.amountPaid,
    };
  });
}

/**
 * The email the Learner gets once their Refund Request is Resolved. There is
 * no mail transport wired up yet, so callers log it.
 */
export function buildRefundRequestResolvedEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
  status: RefundRequestStatus.Approved | RefundRequestStatus.Declined;
}) {
  const approved = input.status === RefundRequestStatus.Approved;
  return {
    to: input.learnerEmail,
    subject: approved
      ? `Refund Request approved — ${input.courseTitle}`
      : `Refund Request declined — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      approved
        ? `We have approved your Refund Request for "${input.courseTitle}". ${formatPrice(input.amount)}, the amount you paid, is on its way back to you. Your access to the course has ended; your progress is kept in case you come back.`
        : `We have declined your Refund Request for "${input.courseTitle}". You keep your access to the course.`,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
