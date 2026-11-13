import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment } from "./comments.server";
import { MAX_COMMENT_LENGTH } from "./comments";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

describe("createComment", () => {
  it("posts a Discussion Question on a lesson", () => {
    const question = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  "
    );

    expect(question).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How do closures work?",
    });
  });

  it("rejects a blank body", () => {
    expect(() => createComment(db, base.user.id, lessonId, null, "   ")).toThrow(
      "Comment cannot be empty"
    );
  });

  it("accepts a body at the length limit and rejects one past it", () => {
    expect(
      createComment(db, base.user.id, lessonId, null, "a".repeat(5000)).body
    ).toHaveLength(5000);
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  });

  it("posts a Discussion Reply under a question on the same lesson", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(reply).toMatchObject({
      userId: base.instructor.id,
      lessonId,
      parentId: question.id,
      body: "Because.",
    });
  });

  it("rejects a reply whose parent does not exist", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, 9999, "Hello?")
    ).toThrow("Parent comment not found");
  });

  it("rejects a reply whose parent is on another lesson", () => {
    const question = createComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Elsewhere"
    );

    expect(() =>
      createComment(db, base.instructor.id, lessonId, question.id, "Answer")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("rejects a reply to a reply", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?");
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "But why?")
    ).toThrow("Replies can only be one level deep");
  });

  it("rejects a comment on a lesson that does not exist", () => {
    expect(() =>
      createComment(db, base.user.id, 9999, null, "Anyone here?")
    ).toThrow("Lesson not found");
  });
});
