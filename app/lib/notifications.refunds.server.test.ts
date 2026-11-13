import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { recordingGateway } from "./knock-gateway.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  raiseRefundRequest,
} from "./refunds.server";
import {
  notifyRefundRequestApproved,
  notifyRefundRequestDeclined,
} from "./notifications.server";

// Refund Request approved / declined: the buyer (the Student, or the Team
// Admin who bought a Team Licence) hears about the Platform Admin's decision.

type TestDb = ReturnType<typeof createTestDb>;

// Noon local time, so the purchase date reads the same in every timezone.
const PURCHASED_AT = new Date(2026, 9, 3, 12, 0, 0);
const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({
      name: "Pat Admin",
      email: "pat@example.com",
      role: UserRole.Admin,
      avatarUrl: "https://example.com/pat.png",
    })
    .returning()
    .get();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buyForSelf(userId: number, amountPaid = 7900) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid,
      createdAt: PURCHASED_AT.toISOString(),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

// A Student who buys a Team Licence (and so is its team's Team Admin).
function addTeamAdmin() {
  return db
    .insert(schema.users)
    .values({
      name: "Tia Lead",
      email: "tia@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buySeats(userId: number, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 5000 * seats,
      createdAt: PURCHASED_AT.toISOString(),
    })
    .returning()
    .get();
  for (let i = 0; i < seats; i++) {
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
  return purchase;
}

function raise(purchaseId: number, buyerId: number) {
  const result = raiseRefundRequest(
    db,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}

function approve(id: number, note: string | null) {
  const result = approveRefundRequest(db, id, platformAdmin.id, note, NOW);
  if (!result.ok) throw new Error(result.error);
}

function decline(id: number, note: string) {
  const result = declineRefundRequest(db, id, platformAdmin.id, note, NOW);
  if (!result.ok) throw new Error(result.error);
}

const student = () => ({
  id: String(base.user.id),
  name: "Test User",
  email: "test@example.com",
});

const admin = () => ({
  id: String(platformAdmin.id),
  name: "Pat Admin",
  email: "pat@example.com",
  avatar: "https://example.com/pat.png",
});

describe("Refund Request approved", () => {
  it("tells the buyer, with the amount, purchase date and note", async () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approve(id, "Sorry it wasn't a fit.");
    const gateway = recordingGateway();

    await notifyRefundRequestApproved(db, id, gateway);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "refund-request-approved",
        idempotencyKey: `refund-request-decided:${id}`,
        payload: {
          recipients: [student()],
          actor: admin(),
          data: {
            course_title: "Test Course",
            amount: "$79.00",
            purchased_on: "Oct 3, 2026",
            decision_note: "Sorry it wasn't a fit.",
            url: "/dashboard",
          },
        },
      },
    ]);
  });

  it("sends an empty note when the Platform Admin wrote none", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    approve(id, null);
    const gateway = recordingGateway();

    await notifyRefundRequestApproved(db, id, gateway);

    expect(gateway.calls[0]).toMatchObject({
      payload: { data: { decision_note: "" } },
    });
  });

  it("tells the Team Admin who bought a Team Licence", async () => {
    const teamAdmin = addTeamAdmin();
    const id = raise(buySeats(teamAdmin.id, 3).id, teamAdmin.id);
    approve(id, null);
    const gateway = recordingGateway();

    await notifyRefundRequestApproved(db, id, gateway);

    expect(gateway.calls).toEqual([
      expect.objectContaining({
        workflowKey: "refund-request-approved",
        idempotencyKey: `refund-request-decided:${id}`,
        payload: expect.objectContaining({
          recipients: [
            {
              id: String(teamAdmin.id),
              name: "Tia Lead",
              email: "tia@example.com",
            },
          ],
          data: expect.objectContaining({ amount: "$150.00" }),
        }),
      }),
    ]);
  });

  it("sends nothing for a request that was declined", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    decline(id, "Past half way.");
    const gateway = recordingGateway();

    await notifyRefundRequestApproved(db, id, gateway);

    expect(gateway.calls).toEqual([]);
  });
});

describe("Refund Request declined", () => {
  it("tells the buyer, with the note and a link back to the course", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    decline(id, "You finished most of the course.");
    const gateway = recordingGateway();

    await notifyRefundRequestDeclined(db, id, gateway);

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "refund-request-declined",
        idempotencyKey: `refund-request-decided:${id}`,
        payload: {
          recipients: [student()],
          actor: admin(),
          data: {
            course_title: "Test Course",
            amount: "$79.00",
            purchased_on: "Oct 3, 2026",
            decision_note: "You finished most of the course.",
            url: "/courses/test-course",
          },
        },
      },
    ]);
  });

  it("tells the Team Admin who bought a Team Licence", async () => {
    const teamAdmin = addTeamAdmin();
    const id = raise(buySeats(teamAdmin.id, 2).id, teamAdmin.id);
    decline(id, "Seats are in use.");
    const gateway = recordingGateway();

    await notifyRefundRequestDeclined(db, id, gateway);

    expect(gateway.calls[0]).toMatchObject({
      workflowKey: "refund-request-declined",
      payload: { recipients: [{ id: String(teamAdmin.id) }] },
    });
  });

  it("sends nothing for a request that is still open", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    const gateway = recordingGateway();

    await notifyRefundRequestDeclined(db, id, gateway);

    expect(gateway.calls).toEqual([]);
  });
});

describe("refund decision failures", () => {
  it("resolves and logs the workflow and idempotency key when Knock fails", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    approve(id, null);
    const gateway = recordingGateway({ failWith: new Error("Knock is down") });

    await expect(
      notifyRefundRequestApproved(db, id, gateway)
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `workflow=refund-request-approved idempotencyKey=refund-request-decided:${id}`
      ),
      expect.any(Error)
    );
  });

  it("does nothing when Knock isn't configured", async () => {
    const id = raise(buyForSelf(base.user.id).id, base.user.id);
    decline(id, "No.");

    await expect(
      notifyRefundRequestDeclined(db, id, null)
    ).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
