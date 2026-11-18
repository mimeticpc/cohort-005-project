import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  deleteNote,
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("bookmarking a Lesson", () => {
  it("bookmarks an unbookmarked Lesson, and removes it on the next toggle", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  # not a heading  ", NOW);

    expect(result).toEqual({
      ok: true,
      note: { body: "# not a heading", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "# not a heading",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "first", NOW);
    saveNote(db, base.user.id, lessonIds[0], "second", minutesAfter(5));

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "second",
      updatedAt: minutesAfter(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
    expect(
      db.select().from(schema.notes).get()?.createdAt
    ).toBe(NOW.toISOString());
  });

  it(`accepts a Note of exactly ${MAX_NOTE_LENGTH} characters`, () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(MAX_NOTE_LENGTH), NOW);
    expect(result.ok).toBe(true);
  });

  it(`refuses a Note over ${MAX_NOTE_LENGTH} characters with a message`, () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "a".repeat(MAX_NOTE_LENGTH + 1), NOW);

    expect(result).toEqual({
      ok: false,
      error: "Notes must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("refuses an empty Note and leaves the existing one in place", () => {
    saveNote(db, base.user.id, lessonIds[0], "something", NOW);

    expect(saveNote(db, base.user.id, lessonIds[0], "   ", minutesAfter(1))).toEqual({
      ok: false,
      error: "Write something before saving your note.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "something",
      updatedAt: NOW.toISOString(),
    });
  });
});

describe("deleting a Note", () => {
  it("removes the Student's Note and leaves other Students' Notes alone", () => {
    const other = addStudent("Priya");
    saveNote(db, base.user.id, lessonIds[0], "mine", NOW);
    saveNote(db, other.id, lessonIds[0], "theirs", NOW);

    expect(deleteNote(db, base.user.id, lessonIds[0])).toBe(true);

    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
    expect(getNote(db, other.id, lessonIds[0])?.body).toBe("theirs");
  });

  it("reports nothing deleted when there was no Note", () => {
    expect(deleteNote(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("lets the Student write a fresh Note afterwards", () => {
    saveNote(db, base.user.id, lessonIds[0], "old", NOW);
    deleteNote(db, base.user.id, lessonIds[0]);

    saveNote(db, base.user.id, lessonIds[0], "new", minutesAfter(1));

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "new",
      updatedAt: minutesAfter(1).toISOString(),
    });
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, with Lesson and Course", () => {
    const other = addStudent("Priya");
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], minutesAfter(1));
    toggleBookmark(db, other.id, lessonIds[0], minutesAfter(2));
    saveNote(db, base.user.id, lessonIds[1], "older", NOW);
    saveNote(db, base.user.id, lessonIds[0], "newer", minutesAfter(1));
    saveNote(db, other.id, lessonIds[0], "not mine", minutesAfter(2));

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      { lessonId: lessonIds[1], lessonTitle: "Lesson 2", courseTitle: "Test Course", courseSlug: "test-course" },
      { lessonId: lessonIds[0], lessonTitle: "Lesson 1", courseTitle: "Test Course", courseSlug: "test-course" },
    ]);
    expect(listNotes(db, base.user.id)).toMatchObject([
      { body: "newer", lessonId: lessonIds[0], courseTitle: "Test Course" },
      { body: "older", lessonId: lessonIds[1], courseTitle: "Test Course" },
    ]);
  });
});
