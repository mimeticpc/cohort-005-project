import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  RefundRequestStatus,
  RefundStatus,
  LessonProgressStatus,
} from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  findApprovedRefundRequestForCourse,
  listRefundRequestsForAdmin,
  listRefundRequestsForLearner,
  resolveRefundRequest,
} from "./refunds.server";

function setup() {
  const db = createTestDb();
  const base = seedBaseData(db);

  const admin = db
    .insert(schema.users)
    .values({
      name: "Ada Admin",
      email: "ada@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  const lesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get();

  // Bought for $50 with a coupon; the Course lists at $79.
  db.update(schema.courses)
    .set({ price: 7900 })
    .where(eq(schema.courses.id, base.course.id))
    .run();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 5000,
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId: base.user.id, courseId: base.course.id })
    .run();
  db.insert(schema.lessonProgress)
    .values({
      userId: base.user.id,
      lessonId: lesson.id,
      status: LessonProgressStatus.Completed,
    })
    .run();

  function raiseRefundRequest(requestedAt = new Date().toISOString()) {
    return db
      .insert(schema.refundRequests)
      .values({ purchaseId: purchase.id, reason: "Not for me.", requestedAt })
      .returning()
      .get();
  }

  function enrollment() {
    return db.select().from(schema.enrollments).get();
  }

  return { db, ...base, admin, lesson, purchase, raiseRefundRequest, enrollment };
}

describe("resolveRefundRequest", () => {
  it("approving creates a Pending Refund for the amount paid and Ends the Enrollment", () => {
    const t = setup();
    const request = t.raiseRefundRequest();

    const result = resolveRefundRequest(t.db, request.id, t.admin.id, "approve");

    expect(result).toMatchObject({
      outcome: "resolved",
      status: RefundRequestStatus.Approved,
      amount: 5000,
    });
    const [learnerRequest] = listRefundRequestsForLearner(t.db, t.user.id, null);
    expect(learnerRequest).toMatchObject({
      status: RefundRequestStatus.Approved,
      refundStatus: RefundStatus.Pending,
    });
    expect(t.enrollment()?.endedAt).not.toBeNull();
  });

  it("approving keeps the Learner's progress", () => {
    const t = setup();
    const request = t.raiseRefundRequest();

    resolveRefundRequest(t.db, request.id, t.admin.id, "approve");

    expect(t.db.select().from(schema.lessonProgress).all()).toHaveLength(1);
  });

  it("declining creates no Refund and leaves the Enrollment Active", () => {
    const t = setup();
    const request = t.raiseRefundRequest();

    const result = resolveRefundRequest(t.db, request.id, t.admin.id, "decline");

    expect(result).toMatchObject({
      outcome: "resolved",
      status: RefundRequestStatus.Declined,
    });
    const [learnerRequest] = listRefundRequestsForLearner(t.db, t.user.id, null);
    expect(learnerRequest.refundStatus).toBeNull();
    expect(t.enrollment()?.endedAt).toBeNull();
  });

  it("the first resolution wins", () => {
    const t = setup();
    const request = t.raiseRefundRequest();

    resolveRefundRequest(t.db, request.id, t.admin.id, "approve");
    const second = resolveRefundRequest(t.db, request.id, t.admin.id, "decline");

    expect(second).toEqual({
      outcome: "already-resolved",
      status: RefundRequestStatus.Approved,
      resolvedByName: "Ada Admin",
    });
  });

  it("a claimed team seat blocks approval but not declining", () => {
    const t = setup();
    const request = t.raiseRefundRequest();
    const team = t.db.insert(schema.teams).values({}).returning().get();
    t.db.insert(schema.coupons)
      .values({
        teamId: team.id,
        code: "SEAT-1",
        courseId: t.course.id,
        purchaseId: t.purchase.id,
        redeemedAt: new Date().toISOString(),
        redeemedByUserId: t.instructor.id,
      })
      .run();

    expect(
      resolveRefundRequest(t.db, request.id, t.admin.id, "approve")
    ).toEqual({ outcome: "seat-claimed" });
    expect(
      resolveRefundRequest(t.db, request.id, t.admin.id, "decline")
    ).toMatchObject({ outcome: "resolved" });
  });

  it("reports an unknown Refund Request", () => {
    const t = setup();
    expect(resolveRefundRequest(t.db, 999, t.admin.id, "approve")).toEqual({
      outcome: "not-found",
    });
  });
});

describe("findApprovedRefundRequestForCourse", () => {
  it("finds the Refund only once a Refund Request is Approved", () => {
    const t = setup();
    const request = t.raiseRefundRequest();

    expect(
      findApprovedRefundRequestForCourse(t.db, t.user.id, t.course.id)
    ).toBeUndefined();

    resolveRefundRequest(t.db, request.id, t.admin.id, "approve");

    expect(
      findApprovedRefundRequestForCourse(t.db, t.user.id, t.course.id)
    ).toBeDefined();
  });
});

describe("listRefundRequestsForAdmin", () => {
  it("lists Open Refund Requests oldest first, warning when watched time is over the limit", () => {
    const t = setup();
    const newer = t.raiseRefundRequest("2026-11-09T10:00:00.000Z");
    const older = t.raiseRefundRequest("2026-11-01T10:00:00.000Z");
    t.db.insert(schema.videoWatchEvents)
      .values({
        userId: t.user.id,
        lessonId: t.lesson.id,
        eventType: "progress",
        positionSeconds: 3 * 60 * 60,
      })
      .run();

    const rows = listRefundRequestsForAdmin(t.db, RefundRequestStatus.Open);

    expect(rows.map((row) => row.id)).toEqual([older.id, newer.id]);
    expect(rows[0]).toMatchObject({
      watchedOverLimit: true,
      seatClaimed: false,
      amountPaid: 5000,
    });
  });

  it("leaves resolved Refund Requests out of the Open list", () => {
    const t = setup();
    const request = t.raiseRefundRequest();
    resolveRefundRequest(t.db, request.id, t.admin.id, "decline");

    expect(listRefundRequestsForAdmin(t.db, RefundRequestStatus.Open)).toEqual([]);
    expect(
      listRefundRequestsForAdmin(t.db, RefundRequestStatus.Declined)
    ).toHaveLength(1);
  });
});
