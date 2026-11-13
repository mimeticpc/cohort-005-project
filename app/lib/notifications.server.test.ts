import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment } from "./comments.server";
import { recordingGateway } from "./knock-gateway.server";
import { notificationCatalogue } from "./notification-catalogue";
import { getFeedConfig, notificationTriggers } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let asker: typeof schema.users.$inferSelect;
let replier: typeof schema.users.$inferSelect;
let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  asker = base.user;
  replier = db
    .insert(schema.users)
    .values({
      name: "Rae Replier",
      email: "rae@example.com",
      role: UserRole.Student,
      avatarUrl: "https://example.com/rae.png",
    })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Closures", position: 1 })
    .returning()
    .get().id;

  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function askQuestion(userId = asker.id) {
  return createComment(
    db,
    userId,
    lessonId,
    null,
    "How do closures work?",
    recordingGateway()
  );
}

describe("Discussion Reply", () => {
  it("notifies the question's author when someone else replies", async () => {
    const question = await askQuestion();
    const gateway = recordingGateway();

    const reply = await createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "A closure **captures** its scope. See `makeCounter()`.",
      gateway
    );

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "discussion-reply",
        idempotencyKey: `discussion-reply:${reply.id}`,
        payload: {
          recipients: [
            {
              id: String(asker.id),
              name: "Test User",
              email: "test@example.com",
            },
          ],
          actor: {
            id: String(replier.id),
            name: "Rae Replier",
            email: "rae@example.com",
            avatar: "https://example.com/rae.png",
          },
          data: {
            course_title: base.course.title,
            lesson_title: "Closures",
            excerpt: "A closure captures its scope. See makeCounter().",
            url: `/courses/${base.course.slug}/lessons/${lessonId}#discussion`,
          },
        },
      },
    ]);
  });

  it("notifies no one when the author replies in their own thread", async () => {
    const question = await askQuestion();
    const gateway = recordingGateway();

    await createComment(
      db,
      asker.id,
      lessonId,
      question.id,
      "Never mind!",
      gateway
    );

    expect(gateway.calls).toEqual([]);
  });

  it("notifies only the question's author, not earlier repliers", async () => {
    const question = await askQuestion();
    await createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "First reply",
      recordingGateway()
    );
    const gateway = recordingGateway();

    await createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Second reply",
      gateway
    );

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toMatchObject({
      method: "trigger",
      payload: {
        recipients: [{ id: String(asker.id) }],
        actor: { id: String(base.instructor.id), name: "Test Instructor" },
      },
    });
  });

  it("does not send a Discussion Reply for a new question", async () => {
    const gateway = recordingGateway();

    await createComment(db, asker.id, lessonId, null, "A question", gateway);

    expect(
      gateway.calls.filter(
        (call) =>
          call.method === "trigger" && call.workflowKey === "discussion-reply"
      )
    ).toEqual([]);
  });

  it("still posts the reply and logs the keys when Knock fails", async () => {
    const question = await askQuestion();
    const gateway = recordingGateway({ failWith: new Error("Knock is down") });

    const reply = await createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "Still here",
      gateway
    );

    expect(reply.body).toBe("Still here");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = errorLog.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("discussion-reply");
    expect(logged).toContain(`discussion-reply:${reply.id}`);
    expect(logged).toContain("Knock is down");
  });

  it("does nothing but warn once when Knock is not configured", async () => {
    const question = await askQuestion();

    // No gateway passed: the default reads KNOCK_*, which the network guard removed.
    const reply = await createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "Unconfigured"
    );

    expect(reply.body).toBe("Unconfigured");
    expect(warnLog).toHaveBeenCalledTimes(1);
    expect(String(warnLog.mock.calls[0][0])).toContain("KNOCK_");
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("New Discussion Question", () => {
  function questionTriggers(gateway: ReturnType<typeof recordingGateway>) {
    return gateway.calls.filter(
      (call) =>
        call.method === "trigger" && call.workflowKey === "discussion-question"
    );
  }

  it("notifies the course's Instructor when a Student asks", async () => {
    const gateway = recordingGateway();

    const question = await createComment(
      db,
      asker.id,
      lessonId,
      null,
      "Why does **this** print `undefined`?",
      gateway
    );

    expect(gateway.calls).toEqual([
      {
        method: "trigger",
        workflowKey: "discussion-question",
        idempotencyKey: `discussion-question:${question.id}`,
        payload: {
          recipients: [
            {
              id: String(base.instructor.id),
              name: "Test Instructor",
              email: "instructor@example.com",
            },
          ],
          actor: {
            id: String(asker.id),
            name: "Test User",
            email: "test@example.com",
          },
          data: {
            course_title: base.course.title,
            lesson_title: "Closures",
            excerpt: "Why does this print undefined?",
            url: "/instructor/questions",
          },
        },
      },
    ]);
  });

  it("notifies the Instructor when a Platform Admin asks", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Ada Admin",
        email: "ada@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const gateway = recordingGateway();

    const question = await createComment(
      db,
      admin.id,
      lessonId,
      null,
      "Is this lesson up to date?",
      gateway
    );

    expect(questionTriggers(gateway)).toEqual([
      expect.objectContaining({
        idempotencyKey: `discussion-question:${question.id}`,
        payload: expect.objectContaining({
          recipients: [
            expect.objectContaining({ id: String(base.instructor.id) }),
          ],
          actor: expect.objectContaining({
            id: String(admin.id),
            name: "Ada Admin",
          }),
        }),
      }),
    ]);
  });

  it("notifies no one when the Instructor asks on their own course", async () => {
    const gateway = recordingGateway();

    await createComment(
      db,
      base.instructor.id,
      lessonId,
      null,
      "Any questions so far?",
      gateway
    );

    expect(gateway.calls).toEqual([]);
  });

  it("does not send a New Discussion Question for a reply", async () => {
    const question = await askQuestion();
    const gateway = recordingGateway();

    await createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "Me too",
      gateway
    );

    expect(questionTriggers(gateway)).toEqual([]);
  });

  it("still posts the question and logs the keys when Knock fails", async () => {
    const gateway = recordingGateway({ failWith: new Error("Knock is down") });

    const question = await createComment(
      db,
      asker.id,
      lessonId,
      null,
      "Still asking",
      gateway
    );

    expect(question.body).toBe("Still asking");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = errorLog.mock.calls[0].map(String).join(" ");
    expect(logged).toContain(`discussion-question:${question.id}`);
    expect(logged).toContain("Knock is down");
  });
});

describe("notificationTriggers", () => {
  it("has a trigger function for every catalogue entry", () => {
    expect(Object.keys(notificationTriggers).sort()).toEqual(
      Object.keys(notificationCatalogue).sort()
    );
    for (const trigger of Object.values(notificationTriggers)) {
      expect(trigger).toBeTypeOf("function");
    }
  });
});

describe("getFeedConfig", () => {
  it("signs a user token for the session user", async () => {
    const gateway = recordingGateway();

    expect(await getFeedConfig(asker.id, gateway)).toEqual({
      knockUserId: String(asker.id),
      publicApiKey: "pk_test_recording",
      feedChannelId: "recording-feed",
      userToken: `signed-token-for-${asker.id}`,
    });
  });

  it("returns null when Knock is not configured", async () => {
    expect(await getFeedConfig(asker.id)).toBeNull();
  });

  it("returns null and logs when signing fails", async () => {
    const gateway = recordingGateway({ failWith: new Error("bad key") });

    expect(await getFeedConfig(asker.id, gateway)).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
