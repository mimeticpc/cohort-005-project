import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import { recordingGateway } from "./knock-gateway.server";
import {
  notificationCatalogue,
  visibleNotifications,
} from "./notification-catalogue";
import {
  loadPreferences,
  savePreference,
} from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createTestDb();
  base = seedBaseData(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPreferences", () => {
  it("shows the code default for a Notification with no stored entry", async () => {
    const rows = await loadPreferences(db, base.user.id, recordingGateway());

    expect(rows).toContainEqual({
      key: "discussion-reply",
      name: "Discussion Reply",
      channels: notificationCatalogue["discussion-reply"].defaults,
    });
  });

  it("shows the stored entry over the code default", async () => {
    const gateway = recordingGateway({
      preferences: {
        [String(base.user.id)]: {
          "discussion-reply": {
            channel_types: { in_app_feed: false, email: false },
          },
        },
      },
    });

    const rows = await loadPreferences(db, base.user.id, gateway);

    const row = rows?.find((r) => r.key === "discussion-reply");
    expect(row?.channels.in_app_feed).toBe(false);
    expect(gateway.calls).toEqual([
      { method: "getPreferences", userId: String(base.user.id) },
    ]);
  });

  it("applies a whole-workflow stored switch to every channel", async () => {
    const gateway = recordingGateway({
      preferences: { [String(base.user.id)]: { "discussion-reply": false } },
    });

    const rows = await loadPreferences(db, base.user.id, gateway);

    const row = rows?.find((r) => r.key === "discussion-reply");
    expect(Object.values(row?.channels ?? {})).not.toContain(true);
  });

  it("keeps stored entries for Notifications the role no longer sees hidden", async () => {
    const gateway = recordingGateway({
      preferences: {
        [String(base.user.id)]: {
          "not-for-students": { channel_types: { in_app_feed: true } },
        },
      },
    });

    const rows = await loadPreferences(db, base.user.id, gateway);

    expect(rows?.map((r) => r.key)).not.toContain("not-for-students");
    expect(gateway.calls.map((c) => c.method)).toEqual(["getPreferences"]);
  });

  it.each([
    ["Student", UserRole.Student],
    ["Instructor", UserRole.Instructor],
    ["Platform Admin", UserRole.Admin],
  ])("shows a %s only their role's rows", async (_label, role) => {
    const user = db
      .insert(schema.users)
      .values({ name: "Role Person", email: `role-${role}@example.com`, role })
      .returning()
      .get();

    const rows = await loadPreferences(db, user.id, recordingGateway());

    expect(rows?.map((r) => r.key)).toEqual(
      visibleNotifications({ role, isTeamAdmin: false }).map((e) => e.key)
    );
  });

  it("shows a Team Admin the Team Admin rows; a plain team member does not count", async () => {
    const team = db.insert(schema.teams).values({}).returning().get();
    const member = db
      .insert(schema.users)
      .values({
        name: "Mo Member",
        email: "mo@example.com",
        role: UserRole.Student,
      })
      .returning()
      .get();
    db.insert(schema.teamMembers)
      .values([
        { teamId: team.id, userId: base.user.id, role: TeamMemberRole.Admin },
        { teamId: team.id, userId: member.id, role: TeamMemberRole.Member },
      ])
      .run();

    const adminRows = await loadPreferences(db, base.user.id, recordingGateway());
    const memberRows = await loadPreferences(db, member.id, recordingGateway());

    expect(adminRows?.map((r) => r.key)).toEqual(
      visibleNotifications({
        role: UserRole.Student,
        isTeamAdmin: true,
      }).map((e) => e.key)
    );
    expect(memberRows?.map((r) => r.key)).toEqual(
      visibleNotifications({
        role: UserRole.Student,
        isTeamAdmin: false,
      }).map((e) => e.key)
    );
  });

  it("returns null when Knock is not configured or the read fails", async () => {
    expect(await loadPreferences(db, base.user.id, null)).toBeNull();
    expect(
      await loadPreferences(
        db,
        base.user.id,
        recordingGateway({ failWith: new Error("knock down") })
      )
    ).toBeNull();
  });
});

describe("savePreference", () => {
  it("identifies the person, then merge-writes both channels for the workflow", async () => {
    const gateway = recordingGateway();

    const result = await savePreference(
      db,
      base.user.id,
      "discussion-reply",
      { feed: true, email: true },
      gateway
    );

    expect(result).toEqual({
      ok: true,
      channels: { in_app_feed: true, email: true },
    });
    expect(gateway.calls).toEqual([
      {
        method: "identify",
        user: {
          id: String(base.user.id),
          name: "Test User",
          email: "test@example.com",
        },
      },
      {
        method: "mergePreferences",
        userId: String(base.user.id),
        workflows: {
          "discussion-reply": {
            channel_types: { in_app_feed: true, email: true },
          },
        },
      },
    ]);
  });

  it("forces email off when the feed is off", async () => {
    const gateway = recordingGateway();

    const result = await savePreference(
      db,
      base.user.id,
      "discussion-reply",
      { feed: false, email: true },
      gateway
    );

    expect(result).toEqual({
      ok: true,
      channels: { in_app_feed: false, email: false },
    });
    expect(gateway.calls.at(-1)).toMatchObject({
      method: "mergePreferences",
      workflows: {
        "discussion-reply": {
          channel_types: { in_app_feed: false, email: false },
        },
      },
    });
  });

  it("refuses a Notification the person's role doesn't see, writing nothing", async () => {
    const gateway = recordingGateway();

    const result = await savePreference(
      db,
      base.user.id,
      "not-a-notification",
      { feed: true, email: true },
      gateway
    );

    expect(result).toEqual({ ok: false });
    expect(gateway.calls).toEqual([]);
  });

  it("reports a failed save when Knock errors or isn't configured", async () => {
    const failing = recordingGateway({ failWith: new Error("knock down") });

    expect(
      await savePreference(
        db,
        base.user.id,
        "discussion-reply",
        { feed: true, email: false },
        failing
      )
    ).toEqual({ ok: false });
    expect(
      await savePreference(
        db,
        base.user.id,
        "discussion-reply",
        { feed: true, email: false },
        null
      )
    ).toEqual({ ok: false });
  });
});
