import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  defaultKnockGateway,
  type KnockGateway,
} from "~/lib/knock-gateway.server";
import { notifyDiscussionReply } from "~/lib/notifications.server";

// ─── Discussion comments ───
// Posting a Discussion Question or Discussion Reply. Both the lesson page and
// /instructor/questions post through here, so the rules live in one place.
//
// Takes the database first, so tests can hand in an in-memory one, and the
// KnockGateway last, so tests can hand in recordingGateway(). Notifications
// are sent after the insert and never make the post fail.

type Db = BetterSQLite3Database<typeof schema>;

// Returns the trimmed body, or throws with a message fit to show the author.
export function assertValidCommentBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export async function createComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  gateway: KnockGateway | null = defaultKnockGateway()
) {
  const trimmed = assertValidCommentBody(body);

  const course = db
    .select({ id: courses.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = db
      .select()
      .from(comments)
      .where(eq(comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  const comment = db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  if (comment.parentId !== null) {
    await notifyDiscussionReply(db, comment.id, gateway);
  }

  return comment;
}
