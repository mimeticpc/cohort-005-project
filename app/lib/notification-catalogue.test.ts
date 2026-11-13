import { existsSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import {
  environmentDefaults,
  notificationCatalogue,
  visibleNotifications,
  type NotificationEntry,
} from "./notification-catalogue";

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

  describe("Discussion Reply", () => {
    it("goes to the feed, on by default, with a View reply CTA", () => {
      expect(notificationCatalogue["discussion-reply"]).toMatchObject({
        key: "discussion-reply",
        idempotencyKeyPrefix: "discussion-reply",
        ctaLabel: "View reply",
        defaults: { in_app_feed: true },
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
});

describe("environmentDefaults", () => {
  it("sets every catalogue entry at workflow × channel_types level only", () => {
    expect(environmentDefaults()).toEqual({
      workflows: {
        "discussion-reply": { channel_types: { in_app_feed: true } },
      },
    });
  });
});
