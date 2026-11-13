import { existsSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import {
  environmentDefaults,
  notificationCatalogue,
  visibleNotifications,
  type NotificationEntry,
} from "./notification-catalogue";
import {
  channelTypeOf,
  EMAIL_CHANNEL_KEY,
  EMAIL_LAYOUT_KEY,
  readWorkflow,
} from "~/test/knock-config";

const entries: NotificationEntry[] = Object.values(notificationCatalogue);

describe("notification catalogue", () => {
  it("never defaults email on while the feed is off", () => {
    for (const entry of entries) {
      if (entry.defaults.email) {
        expect(entry.defaults.in_app_feed, entry.key).toBe(true);
      }
    }
  });

  it("gives every entry an idempotency-key prefix and a CTA label", () => {
    for (const entry of entries) {
      expect(entry.idempotencyKeyPrefix, entry.key).toMatch(/^[a-z-]+$/);
      expect(entry.ctaLabel, entry.key).not.toBe("");
    }
  });

  it("keys each entry by its workflow key", () => {
    for (const [key, entry] of Object.entries(notificationCatalogue)) {
      expect(entry.key).toBe(key);
    }
  });

  describe("New Discussion Question", () => {
    it("goes to the feed and by email, both on by default, with an Answer CTA", () => {
      expect(notificationCatalogue["discussion-question"]).toMatchObject({
        key: "discussion-question",
        idempotencyKeyPrefix: "discussion-question",
        ctaLabel: "Answer",
        defaults: { in_app_feed: true, email: true },
      });
    });

    it("targets /instructor/questions", () => {
      const entry = notificationCatalogue["discussion-question"];
      expect(entry.target({ url: "/instructor/questions" })).toBe(
        "/instructor/questions"
      );
      expect(entry.target({ url: "https://evil.example/x" })).toBeNull();
    });

    it("is shown only to Instructors", () => {
      const keysFor = (role: UserRole) =>
        visibleNotifications({ role, isTeamAdmin: false }).map((e) => e.key);

      expect(keysFor(UserRole.Instructor)).toContain("discussion-question");
      expect(keysFor(UserRole.Student)).not.toContain("discussion-question");
      expect(keysFor(UserRole.Admin)).not.toContain("discussion-question");
    });
  });

  describe("Discussion Reply", () => {
    it("goes to the feed and by email, both on by default, with a View reply CTA", () => {
      expect(notificationCatalogue["discussion-reply"]).toMatchObject({
        key: "discussion-reply",
        idempotencyKeyPrefix: "discussion-reply",
        ctaLabel: "View reply",
        defaults: { in_app_feed: true, email: true },
      });
    });

    it("targets the lesson discussion URL sent in the trigger data", () => {
      const entry = notificationCatalogue["discussion-reply"];
      expect(
        entry.target({ url: "/courses/intro/lessons/3#discussion" })
      ).toBe("/courses/intro/lessons/3#discussion");
    });

    it("has no target when the trigger data carries no in-app URL", () => {
      const entry = notificationCatalogue["discussion-reply"];
      expect(entry.target({})).toBeNull();
      expect(entry.target({ url: "https://evil.example/x" })).toBeNull();
      expect(entry.target({ url: "//evil.example/x" })).toBeNull();
    });

    it("is shown to every role", () => {
      for (const role of [
        UserRole.Student,
        UserRole.Instructor,
        UserRole.Admin,
      ]) {
        expect(
          visibleNotifications({ role, isTeamAdmin: false }).map((e) => e.key)
        ).toContain("discussion-reply");
      }
    });
  });
});

describe("Seat claimed", () => {
  const entry = notificationCatalogue["seat-claimed"];

  it("is on in the feed and off by email by default, with a View team CTA to /team", () => {
    expect(entry).toMatchObject({
      idempotencyKeyPrefix: "seat-claimed",
      ctaLabel: "View team",
      defaults: { in_app_feed: true, email: false },
    });
    expect(entry.target({ url: "/team" })).toBe("/team");
  });

  it("is shown only to Team Admins", () => {
    const keysFor = (role: UserRole, isTeamAdmin: boolean) =>
      visibleNotifications({ role, isTeamAdmin }).map((e) => e.key);

    expect(keysFor(UserRole.Student, true)).toContain("seat-claimed");
    expect(keysFor(UserRole.Student, false)).not.toContain("seat-claimed");
    expect(keysFor(UserRole.Instructor, false)).not.toContain("seat-claimed");
  });
});

describe("New Enrollment", () => {
  const entry = notificationCatalogue["new-enrollment"];

  it("is off on every channel by default, with a See students CTA", () => {
    expect(entry).toMatchObject({
      idempotencyKeyPrefix: "enrollment-created",
      ctaLabel: "See students",
      defaults: { in_app_feed: false, email: false },
    });
  });

  it("targets the course's student list from the course id in the data", () => {
    expect(entry.target({ course_id: "7" })).toBe("/instructor/7/students");
    expect(entry.target({})).toBeNull();
    expect(entry.target({ course_id: "../admin" })).toBeNull();
  });

  it("is shown only to Instructors", () => {
    const keysFor = (role: UserRole) =>
      visibleNotifications({ role, isTeamAdmin: true }).map((e) => e.key);

    expect(keysFor(UserRole.Instructor)).toContain("new-enrollment");
    expect(keysFor(UserRole.Student)).not.toContain("new-enrollment");
    expect(keysFor(UserRole.Admin)).not.toContain("new-enrollment");
  });
});

describe("knock/workflows", () => {
  it("defines a workflow in the repo for every catalogue entry", () => {
    const workflowsDir = new URL("../../knock/workflows/", import.meta.url);
    const workflowKeys = readdirSync(workflowsDir).filter((name) =>
      existsSync(new URL(`${name}/workflow.json`, workflowsDir))
    );

    expect(workflowKeys.sort()).toEqual(
      Object.keys(notificationCatalogue).sort()
    );
  });

  it.each(entries.map((entry) => [entry.key, entry] as const))(
    "%s has one channel step per catalogue channel",
    (key, entry) => {
      const workflow = readWorkflow(key);
      const stepChannels = workflow.steps
        .filter((step) => step.type === "channel")
        .map((step) => channelTypeOf[step.channel_key]);

      expect(stepChannels.sort()).toEqual(Object.keys(entry.defaults).sort());
    }
  );

  it.each(
    entries
      .filter((entry) => "email" in entry.defaults)
      .map((entry) => [entry.key] as const)
  )("%s emails with the shared Cadence layout", (key) => {
    const emailStep = readWorkflow(key).steps.find(
      (step) => step.channel_key === EMAIL_CHANNEL_KEY
    );

    expect(emailStep?.template.settings?.layout_key).toBe(EMAIL_LAYOUT_KEY);
    expect(
      existsSync(
        new URL(`../../knock/layouts/${EMAIL_LAYOUT_KEY}/layout.json`, import.meta.url)
      )
    ).toBe(true);
  });
});

describe("environmentDefaults", () => {
  it("sets every catalogue entry at workflow × channel_types level only", () => {
    expect(environmentDefaults()).toEqual({
      workflows: {
        "discussion-question": {
          channel_types: { in_app_feed: true, email: true },
        },
        "discussion-reply": {
          channel_types: { in_app_feed: true, email: true },
        },
        "seat-claimed": {
          channel_types: { in_app_feed: true, email: false },
        },
        "new-enrollment": {
          channel_types: { in_app_feed: false, email: false },
        },
      },
    });
  });
});
