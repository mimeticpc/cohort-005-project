// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?" (#49).
// Lives on branch prototype/knock-spike only. Never merge.
// Run: npm run dev, open /prototype/knock, switch users with the DevUI panel.
import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  WORKFLOW_DISCUSSION_REPLY,
  WORKFLOW_NEW_ENROLLMENT,
  getPreferences,
  identify,
  publicConfig,
  setWorkflowPreference,
  signFor,
  trigger,
  unsetPreferences,
} from "~/lib/prototype-knock.server";

async function currentUser(request: Request) {
  const id = await getCurrentUserId(request);
  if (!id) return null;
  return db.query.users.findFirst({ where: eq(users.id, id) }) ?? null;
}

function errorText(e: unknown) {
  if (e && typeof e === "object" && "status" in e) {
    const err = e as { status?: number; message?: string };
    return `HTTP ${err.status}: ${err.message}`;
  }
  return String(e);
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await currentUser(request);
  if (!user) return { user: null } as const;

  await identify(user);
  const token = await signFor(user.id);
  let preferences: unknown;
  try {
    preferences = await getPreferences(user.id);
  } catch (e) {
    preferences = { error: errorText(e) };
  }

  // Candidate Discussion Replies: top-level questions written by someone else,
  // so the current user plays the replier and the question author is notified.
  const questions = await db
    .select({
      id: comments.id,
      lessonId: comments.lessonId,
      body: comments.body,
      authorId: users.id,
      authorName: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, user.id)
      )
    )
    .limit(5);

  const courseList = await db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: users.id,
      instructorName: users.name,
    })
    .from(courses)
    .innerJoin(users, eq(users.id, courses.instructorId))
    .limit(5);

  return {
    user: { id: user.id, name: user.name, role: user.role },
    token,
    ...publicConfig(),
    preferences,
    questions,
    courses: courseList,
  } as const;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await currentUser(request);
  if (!user) return { log: "no user selected" };
  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    if (intent === "reply") {
      const questionId = Number(form.get("questionId"));
      const q = await db.query.comments.findFirst({
        where: eq(comments.id, questionId),
      });
      const author = q
        ? await db.query.users.findFirst({ where: eq(users.id, q.userId) })
        : undefined;
      if (!q || !author) return { log: "question not found" };
      const [where] = await db
        .select({ slug: courses.slug })
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .innerJoin(courses, eq(courses.id, modules.courseId))
        .where(eq(lessons.id, q.lessonId));
      const res = await trigger(WORKFLOW_DISCUSSION_REPLY, user, [author], {
        lesson_id: q.lessonId,
        question_id: q.id,
        question_title: q.body.split("\n")[0].slice(0, 80),
        discussion_url: `/courses/${where?.slug}/lessons/${q.lessonId}#comment-${q.id}`,
        question_excerpt: q.body.slice(0, 80),
        reply_excerpt: `PROTOTYPE reply from ${user.name}`,
      });
      return {
        log: `triggered ${WORKFLOW_DISCUSSION_REPLY} → ${author.name} (#${author.id}); workflow_run_id=${res.workflow_run_id}`,
      };
    }
    if (intent === "enroll") {
      const courseId = Number(form.get("courseId"));
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });
      const instructor = course
        ? await db.query.users.findFirst({
            where: eq(users.id, course.instructorId),
          })
        : undefined;
      if (!course || !instructor) return { log: "course not found" };
      const res = await trigger(WORKFLOW_NEW_ENROLLMENT, user, [instructor], {
        course_id: course.id,
        course_title: course.title,
      });
      return {
        log: `triggered ${WORKFLOW_NEW_ENROLLMENT} → ${instructor.name} (#${instructor.id}); workflow_run_id=${res.workflow_run_id}`,
      };
    }
    if (intent === "opt-in" || intent === "opt-out") {
      const res = await setWorkflowPreference(
        user.id,
        WORKFLOW_NEW_ENROLLMENT,
        intent === "opt-in"
      );
      return { log: `${intent} saved: ${JSON.stringify(res)}` };
    }
    if (intent === "reset-prefs") {
      await unsetPreferences(user.id);
      return { log: "user preference set removed (back to environment defaults)" };
    }
  } catch (e) {
    return { log: `ERROR ${intent}: ${errorText(e)}` };
  }
  return { log: `unknown intent ${intent}` };
}

type FeedItem = {
  id: string;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
  source: { key: string; categories?: string[] };
  actors: { id?: string; name?: string | null }[];
  data: Record<string, unknown> | null;
  blocks: { name: string; rendered?: string; content?: string }[];
};
type FeedSnapshot = {
  items: FeedItem[];
  metadata: { unread_count: number; unseen_count: number; total_count: number };
  networkStatus: number;
};

function useKnockFeed(userId: string, token: string, publicKey: string, channelId: string) {
  const [snapshot, setSnapshot] = useState<FeedSnapshot | null>(null);
  const [feed, setFeed] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let knock: any;
    let f: any;
    (async () => {
      const { default: Knock } = await import("@knocklabs/client");
      if (disposed) return;
      knock = new Knock(publicKey);
      knock.authenticate(userId, token);
      f = knock.feeds.initialize(channelId, { archived: "exclude" });
      f.listenForUpdates();
      f.store.subscribe((s: FeedSnapshot) => !disposed && setSnapshot({ ...s }));
      setFeed(f);
      try {
        await f.fetch();
        setSnapshot({ ...f.getState() });
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      f?.dispose();
      knock?.teardown();
      setSnapshot(null);
      setFeed(null);
    };
  }, [userId, token, publicKey, channelId]);

  return { snapshot, feed, error };
}

function decodeJwt(token: string) {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export default function PrototypeKnock({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  if (!loaderData.user) {
    return (
      <div className="p-8">
        PROTOTYPE: select a user from the DevUI panel to load their Knock feed.
      </div>
    );
  }
  const { user, token, publicKey, channelId, preferences, questions, courses } = loaderData;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-sm">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        PROTOTYPE — Knock spike (#49). Throwaway; never merge.
      </div>

      <section className="space-y-1">
        <h2 className="font-semibold">1. Signed user token</h2>
        <div>
          Cadence user: <b>{user.name}</b> (#{user.id}, {user.role})
        </div>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(decodeJwt(token), null, 2)}
        </pre>
      </section>

      <Feed key={user.id} userId={String(user.id)} token={token} publicKey={publicKey} channelId={channelId} />

      <section className="space-y-2">
        <h2 className="font-semibold">2. Trigger via Node SDK</h2>
        <div>Discussion Reply (you reply → question author is notified):</div>
        {questions.length === 0 && <div className="text-muted-foreground">no questions by other users</div>}
        {questions.map((q) => (
          <Form method="post" key={q.id} className="flex items-center gap-2">
            <input type="hidden" name="intent" value="reply" />
            <input type="hidden" name="questionId" value={q.id} />
            <button className="rounded border px-2 py-1 hover:bg-muted" disabled={nav.state !== "idle"}>
              Reply
            </button>
            <span>
              → {q.authorName} (#{q.authorId}): “{q.body.slice(0, 60)}”
            </span>
          </Form>
        ))}
        <div className="pt-2">New Enrollment (you enroll → Instructor is notified, only if opted in):</div>
        {courses.map((c) => (
          <Form method="post" key={c.id} className="flex items-center gap-2">
            <input type="hidden" name="intent" value="enroll" />
            <input type="hidden" name="courseId" value={c.id} />
            <button className="rounded border px-2 py-1 hover:bg-muted" disabled={nav.state !== "idle"}>
              Enroll
            </button>
            <span>
              {c.title} → {c.instructorName} (#{c.instructorId})
            </span>
          </Form>
        ))}
        {actionData?.log && (
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{actionData.log}</pre>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">4. Preferences ({user.name})</h2>
        <div className="flex gap-2">
          {(["opt-in", "opt-out", "reset-prefs"] as const).map((intent) => (
            <Form method="post" key={intent}>
              <input type="hidden" name="intent" value={intent} />
              <button className="rounded border px-2 py-1 hover:bg-muted" disabled={nav.state !== "idle"}>
                {intent === "reset-prefs" ? "reset to defaults" : `${intent} New Enrollment`}
              </button>
            </Form>
          ))}
        </div>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(preferences, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Feed(props: { userId: string; token: string; publicKey: string; channelId: string }) {
  const { snapshot, feed, error } = useKnockFeed(props.userId, props.token, props.publicKey, props.channelId);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">3. Headless feed API (user {props.userId})</h2>
      {error && <pre className="text-red-600">{error}</pre>}
      {!snapshot ? (
        <div className="text-muted-foreground">loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <span>
              unread <b>{snapshot.metadata.unread_count}</b> · unseen <b>{snapshot.metadata.unseen_count}</b> · total{" "}
              <b>{snapshot.metadata.total_count}</b>
            </span>
            <button className="rounded border px-2 py-1 hover:bg-muted" onClick={() => feed?.markAllAsSeen()}>
              mark all seen
            </button>
            <button className="rounded border px-2 py-1 hover:bg-muted" onClick={() => feed?.markAllAsRead()}>
              mark all read
            </button>
            <button className="rounded border px-2 py-1 hover:bg-muted" onClick={() => feed?.fetch()}>
              refetch
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>workflow</th>
                <th>actor</th>
                <th>body</th>
                <th>seen</th>
                <th>read</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshot.items.map((item) => (
                <tr key={item.id} className="border-t align-top">
                  <td>{item.source.key}</td>
                  <td>{item.actors.map((a) => a.name ?? a.id).join(", ")}</td>
                  <td>
                    {item.blocks.map((b) => (
                      <div key={b.name} dangerouslySetInnerHTML={{ __html: b.rendered ?? b.content ?? "" }} />
                    ))}
                    <code className="text-muted-foreground">{JSON.stringify(item.data)}</code>
                  </td>
                  <td>{item.seen_at ? "✓" : "–"}</td>
                  <td>{item.read_at ? "✓" : "–"}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    <button className="underline" onClick={() => feed?.markAsSeen(item)}>seen</button>
                    <button className="underline" onClick={() => feed?.markAsRead(item)}>read</button>
                    <button className="underline" onClick={() => feed?.markAsUnread(item)}>unread</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.items.length === 0 && <div className="text-muted-foreground">feed empty</div>}
        </>
      )}
    </section>
  );
}
