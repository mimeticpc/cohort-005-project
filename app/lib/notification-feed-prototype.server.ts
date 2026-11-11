// PROTOTYPE, throwaway. Answers "What does the Notification Feed look like in
// Cadence?" (mimeticpc/cohort-005-project#47). Lives on
// prototype/notification-feed only; never merge.
//
// Only two workflows exist in the Knock Development env (discussion-reply,
// new-enrollment). To show the whole catalogue, every demo Notification goes
// through `discussion-reply` with a `kind` in its data; the feed rows render
// from `data`, not from Knock's template, which is how the real feed will work
// (headless, copy owned by Cadence).
import Knock, { signUserToken } from "@knocklabs/node";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "~/db";
import { comments, courses, lessons, modules, users, UserRole } from "~/db/schema";

if (!process.env.KNOCK_SECRET_API_KEY) {
  process.loadEnvFile(".env");
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`PROTOTYPE: ${name} missing from .env`);
  return value;
}

export const knock = new Knock({ apiKey: env("KNOCK_SECRET_API_KEY") });

export async function getFeedConfig(cadenceUserId: number) {
  return {
    knockUserId: String(cadenceUserId),
    publicApiKey: env("KNOCK_PUBLIC_API_KEY"),
    feedChannelId: env("KNOCK_FEED_CHANNEL_ID"),
    userToken: await signUserToken(String(cadenceUserId), {
      signingKey: env("KNOCK_SIGNING_KEY"),
      expiresInSeconds: 60 * 60,
    }),
  };
}

export type FeedConfig = Awaited<ReturnType<typeof getFeedConfig>>;

type Demo = { kind: string; actorId: number; data: Record<string, unknown> };

// Builds a role-appropriate set of demo Notifications from real seed data, so
// every link in the feed goes somewhere that exists.
export async function seedDemoNotifications(cadenceUserId: number) {
  const me = db.select().from(users).where(eq(users.id, cadenceUserId)).get()!;
  const others = db.select().from(users).where(ne(users.id, me.id)).all();
  const pick = (i: number) => others[i % others.length];

  const lesson = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      slug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(
      me.role === UserRole.Instructor ? eq(courses.instructorId, me.id) : undefined
    )
    .limit(1)
    .get()!;

  const question = db
    .select({ body: comments.body })
    .from(comments)
    .where(and(isNull(comments.parentId), isNull(comments.deletedAt)))
    .limit(1)
    .get();

  const lessonUrl = `/courses/${lesson.slug}/lessons/${lesson.lessonId}`;
  const course = { course_title: lesson.courseTitle, course_url: `/courses/${lesson.slug}` };
  const q = {
    question_title: lesson.lessonTitle,
    question_excerpt: (question?.body ?? "How does this work?").slice(0, 90),
    lesson_title: lesson.lessonTitle,
    discussion_url: `${lessonUrl}#discussion`,
  };

  const demos: Demo[] = [];
  if (me.role === UserRole.Student) {
    demos.push(
      { kind: "discussion-reply", actorId: pick(0).id, data: q },
      { kind: "refund-approved", actorId: pick(1).id, data: { ...course, url: "/dashboard" } },
      { kind: "refund-declined", actorId: pick(2).id, data: { ...course, url: course.course_url } },
      { kind: "discussion-reply", actorId: pick(3).id, data: q }
    );
  }
  if (me.role === UserRole.Instructor) {
    demos.push(
      { kind: "discussion-question", actorId: pick(0).id, data: { ...q, url: "/instructor/questions" } },
      { kind: "new-enrollment", actorId: pick(1).id, data: { ...course, url: `/instructor/${lesson.courseId}/students` } },
      { kind: "new-enrollment", actorId: pick(2).id, data: { ...course, url: `/instructor/${lesson.courseId}/students` } },
      { kind: "discussion-question", actorId: pick(3).id, data: { ...q, url: "/instructor/questions" } },
      { kind: "discussion-reply", actorId: pick(4).id, data: q }
    );
  }
  if (me.role === UserRole.Admin) {
    demos.push(
      { kind: "refund-requested", actorId: pick(0).id, data: { ...course, url: "/admin/refunds" } },
      { kind: "refund-requested", actorId: pick(1).id, data: { ...course, url: "/admin/refunds" } },
      { kind: "discussion-reply", actorId: pick(2).id, data: q }
    );
  }
  // Team Admin is not a role; any role can also run a Team. Seed one anyway so
  // every variant shows a Seat claimed row.
  demos.push({
    kind: "seat-claimed",
    actorId: pick(5).id,
    data: { ...course, team_name: "Acme Corp", url: "/team" },
  });

  for (const d of demos) {
    const actor = others.find((o) => o.id === d.actorId)!;
    await knock.workflows.trigger("discussion-reply", {
      recipients: [{ id: String(me.id), name: me.name, email: me.email }],
      actor: { id: String(actor.id), name: actor.name, email: actor.email, avatar: actor.avatarUrl ?? undefined },
      data: { question_title: "", discussion_url: "", ...d.data, kind: d.kind },
    });
    // Spread inserted_at so relative times and day groups differ a little.
    await new Promise((r) => setTimeout(r, 250));
  }
  return demos.length;
}
