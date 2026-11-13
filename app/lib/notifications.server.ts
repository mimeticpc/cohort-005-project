import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { commentExcerpt } from "~/lib/comment-markdown.server";
import {
  defaultKnockGateway,
  type KnockGateway,
  type KnockUser,
} from "~/lib/knock-gateway.server";
import {
  idempotencyKey,
  type NotificationKey,
} from "~/lib/notification-catalogue";

// ─── Notification triggers ───
// One function per Notification in the catalogue, each taking the database,
// the id of the row that caused it, and the KnockGateway (defaulting to the
// real one). Call them after the domain write has committed, never inside
// db.transaction. They never throw: a Notification problem must not fail
// the action that caused it.
//
// Each trigger looks up its recipients, removes the actor, inline-identifies
// recipients and actor, and sends `<prefix>:<row id>` as the idempotency key.

type Db = BetterSQLite3Database<typeof schema>;
type User = typeof users.$inferSelect;

export type NotificationTrigger = (
  db: Db,
  rowId: number,
  gateway?: KnockGateway | null
) => Promise<void>;

export function toKnockUser(user: User): KnockUser {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    ...(user.avatarUrl ? { avatar: user.avatarUrl } : {}),
  };
}

async function send(
  gateway: KnockGateway | null,
  key: NotificationKey,
  rowId: number,
  actor: User,
  recipients: User[],
  data: Record<string, string>
) {
  const idempotency = idempotencyKey(key, rowId);
  if (!gateway) {
    console.warn(
      `[notifications] KNOCK_* env vars are not set; skipped ${idempotency}`
    );
    return;
  }

  const others = recipients.filter((user) => user.id !== actor.id);
  if (others.length === 0) return;

  try {
    await gateway.trigger(
      key,
      {
        recipients: others.map(toKnockUser),
        actor: toKnockUser(actor),
        data,
      },
      idempotency
    );
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=${key} idempotencyKey=${idempotency}:`,
      error
    );
  }
}

export function lessonDiscussionUrl(courseSlug: string, lessonId: number) {
  return `/courses/${courseSlug}/lessons/${lessonId}#discussion`;
}

// Discussion Reply: tells the Discussion Question's author that someone
// else replied. Later repliers in the thread are not notified (no follow).
export const notifyDiscussionReply: NotificationTrigger = async (
  db,
  commentId,
  gateway = defaultKnockGateway()
) => {
  try {
    const reply = db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .get();
    if (!reply || reply.parentId === null) return;

    const question = db
      .select()
      .from(comments)
      .where(eq(comments.id, reply.parentId))
      .get();
    const place = db
      .select({
        lessonTitle: lessons.title,
        courseTitle: courses.title,
        courseSlug: courses.slug,
      })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, reply.lessonId))
      .get();
    const actor = db
      .select()
      .from(users)
      .where(eq(users.id, reply.userId))
      .get();
    const asker = question
      ? db.select().from(users).where(eq(users.id, question.userId)).get()
      : undefined;
    if (!place || !actor || !asker) return;

    await send(gateway, "discussion-reply", reply.id, actor, [asker], {
      course_title: place.courseTitle,
      lesson_title: place.lessonTitle,
      excerpt: commentExcerpt(reply.body),
      url: lessonDiscussionUrl(place.courseSlug, reply.lessonId),
    });
  } catch (error) {
    console.error(
      `[notifications] trigger failed workflow=discussion-reply idempotencyKey=${idempotencyKey("discussion-reply", commentId)}:`,
      error
    );
  }
};

export const notificationTriggers = {
  "discussion-reply": notifyDiscussionReply,
} satisfies Record<NotificationKey, NotificationTrigger>;

// ─── Notification Feed config ───
// What the browser needs to poll the session user's feed: public key, feed
// channel and a signed RS256 user token. Signing is local (no network call),
// so the layout loader can call this per request; it follows the DevUI user
// switcher because the loader re-runs. Null when Knock isn't configured or
// signing fails — the bell then shows "Couldn't load Notifications".

export type FeedConfig = {
  knockUserId: string;
  publicApiKey: string;
  feedChannelId: string;
  userToken: string;
};

export async function getFeedConfig(
  userId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
): Promise<FeedConfig | null> {
  if (!gateway) return null;
  try {
    const knockUserId = String(userId);
    return {
      knockUserId,
      publicApiKey: gateway.feed.publicApiKey,
      feedChannelId: gateway.feed.channelId,
      userToken: await gateway.signUserToken(knockUserId),
    };
  } catch (error) {
    console.error("[notifications] could not sign a Knock user token:", error);
    return null;
  }
}
