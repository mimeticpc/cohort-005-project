import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import { recordingGateway } from "./knock-gateway.server";
import {
  notifyCouponRedeemed,
  notifyNewEnrollment,
  notifySeatClaimed,
} from "./notifications.server";

// Seat claimed and New Enrollment (#66). The redeem code action calls
// notifyCouponRedeemed after a successful redeem; the course purchase action
// calls notifyNewEnrollment after an Individual Purchase.

type TestDb = ReturnType<typeof createTestDb>;
type User = typeof schema.users.$inferSelect;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: User;
let claimer: User;
let teamId: number;
let purchaseId: number;
let seatIds: number[];

function addUser(name: string, email: string, avatarUrl?: string) {
  return db
    .insert(schema.users)
    .values({ name, email, role: UserRole.Student, avatarUrl })
    .returning()
    .get();
}

function addTeamMember(userId: number, role: TeamMemberRole) {
  db.insert(schema.teamMembers).values({ teamId, userId, role }).run();
}

// The redeem write the redeem code action does: claim the Seat, enroll.
function redeem(seatId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: new Date().toISOString() })
    .where(eq(schema.coupons.id, seatId))
    .run();
  return db
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = addUser("Bossy McBossface", "bossy@example.com");
  claimer = addUser("Cara Claimer", "cara@example.com", "https://img.example/cara.png");

  teamId = db.insert(schema.teams).values({}).returning().get().id;
  addTeamMember(teamAdmin.id, TeamMemberRole.Admin);
  purchaseId = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 30000,
      country: "US",
    })
    .returning()
    .get().id;
  seatIds = [1, 2, 3].map(
    (n) =>
      db
        .insert(schema.coupons)
        .values({
          teamId,
          courseId: base.course.id,
          purchaseId,
          code: `SEAT-${n}`,
        })
        .returning()
        .get().id
  );

  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Seat claimed", () => {
  it("notifies the team's Team Admin with the course and Seat counts", async () => {
    redeem(seatIds[0], claimer.id);
    const gateway = recordingGateway();

    await notifySeatClaimed(db, seatIds[0], gateway);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "seat-claimed",
        idempotencyKey: `seat-claimed:${seatIds[0]}`,
        payload: {
          recipients: [
            {
              id: String(teamAdmin.id),
              name: "Bossy McBossface",
              email: "bossy@example.com",
            },
          ],
          actor: {
            id: String(claimer.id),
            name: "Cara Claimer",
            email: "cara@example.com",
            avatar: "https://img.example/cara.png",
          },
          data: {
            course_title: base.course.title,
            seats_left: "2",
            seats_total: "3",
            url: "/team",
          },
        },
      },
    ]);
  });

  it("notifies every Team Admin of the team except the claimer, and no Team Members", async () => {
    const coAdmin = addUser("Ada Admin", "ada@example.com");
    const member = addUser("Mo Member", "mo@example.com");
    addTeamMember(coAdmin.id, TeamMemberRole.Admin);
    addTeamMember(member.id, TeamMemberRole.Member);
    addTeamMember(claimer.id, TeamMemberRole.Admin);
    redeem(seatIds[0], claimer.id);
    const gateway = recordingGateway();

    await notifySeatClaimed(db, seatIds[0], gateway);

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toMatchObject({
      payload: {
        recipients: [{ id: String(teamAdmin.id) }, { id: String(coAdmin.id) }],
        actor: { id: String(claimer.id) },
      },
    });
  });

  it("does not notify a lone Team Admin who claims their own Seat", async () => {
    redeem(seatIds[0], teamAdmin.id);
    const gateway = recordingGateway();

    await notifySeatClaimed(db, seatIds[0], gateway);

    expect(gateway.calls).toEqual([]);
  });

  it("does not count refunded Unclaimed Seats", async () => {
    redeem(seatIds[0], claimer.id);
    db.update(schema.coupons)
      .set({ refundedAt: new Date().toISOString() })
      .where(eq(schema.coupons.id, seatIds[2]))
      .run();
    const gateway = recordingGateway();

    await notifySeatClaimed(db, seatIds[0], gateway);

    expect(gateway.calls[0]).toMatchObject({
      payload: { data: { seats_left: "1", seats_total: "2" } },
    });
  });

  it("logs the keys and does not throw when Knock fails", async () => {
    redeem(seatIds[0], claimer.id);
    const gateway = recordingGateway({ failWith: new Error("Knock is down") });

    await notifySeatClaimed(db, seatIds[0], gateway);

    const logged = vi.mocked(console.error).mock.calls[0].map(String).join(" ");
    expect(logged).toContain(`seat-claimed:${seatIds[0]}`);
    expect(logged).toContain("Knock is down");
  });
});

describe("coupon redeem", () => {
  it("fires both Seat claimed and New Enrollment", async () => {
    const enrollment = redeem(seatIds[0], claimer.id);
    const gateway = recordingGateway();

    await notifyCouponRedeemed(db, seatIds[0], enrollment.id, gateway);

    expect(
      gateway.calls.map((call) =>
        call.method === "trigger"
          ? [call.workflowKey, call.idempotencyKey]
          : [call.method]
      )
    ).toEqual([
      ["seat-claimed", `seat-claimed:${seatIds[0]}`],
      ["new-enrollment", `enrollment-created:${enrollment.id}`],
    ]);
  });

  it("still sends New Enrollment when a lone Team Admin claims their own Seat", async () => {
    const enrollment = redeem(seatIds[0], teamAdmin.id);
    const gateway = recordingGateway();

    await notifyCouponRedeemed(db, seatIds[0], enrollment.id, gateway);

    expect(gateway.calls).toMatchObject([
      { method: "trigger", workflowKey: "new-enrollment" },
    ]);
  });
});

describe("New Enrollment", () => {
  function enroll(userId: number) {
    return db
      .insert(schema.enrollments)
      .values({ userId, courseId: base.course.id })
      .returning()
      .get();
  }

  it("notifies the course's Instructor of an Individual Purchase", async () => {
    const enrollment = enroll(base.user.id);
    const gateway = recordingGateway();

    await notifyNewEnrollment(db, enrollment.id, gateway);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "new-enrollment",
        idempotencyKey: `enrollment-created:${enrollment.id}`,
        payload: {
          recipients: [
            {
              id: String(base.instructor.id),
              name: "Test Instructor",
              email: "instructor@example.com",
            },
          ],
          actor: {
            id: String(base.user.id),
            name: "Test User",
            email: "test@example.com",
          },
          data: {
            course_title: base.course.title,
            course_id: String(base.course.id),
            url: `/instructor/${base.course.id}/students`,
          },
        },
      },
    ]);
  });

  it("notifies again when a Lapsed Student enrolls again", async () => {
    const first = enroll(base.user.id);
    db.delete(schema.enrollments)
      .where(eq(schema.enrollments.id, first.id))
      .run();
    const again = enroll(base.user.id);
    const gateway = recordingGateway();

    await notifyNewEnrollment(db, again.id, gateway);

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toMatchObject({
      idempotencyKey: `enrollment-created:${again.id}`,
    });
  });

  it("does not notify an Instructor enrolling in their own course", async () => {
    const enrollment = enroll(base.instructor.id);
    const gateway = recordingGateway();

    await notifyNewEnrollment(db, enrollment.id, gateway);

    expect(gateway.calls).toEqual([]);
  });
});
