import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/saved";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { listBookmarks, listNotes } from "~/lib/saved.server";
import { Card, CardContent } from "~/components/ui/card";
import { Bookmark, NotebookPen } from "lucide-react";
import { formatRelativeTime } from "~/lib/utils";

export function meta() {
  return [
    { title: "Saved — Cadence" },
    { name: "description", content: "Your bookmarks and notes" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  return {
    savedBookmarks: listBookmarks(db, userId),
    savedNotes: listNotes(db, userId),
  };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { savedBookmarks, savedNotes } = loaderData;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          The lessons you flagged, and what you wrote about them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SavedSection
          icon={<Bookmark className="size-4 text-muted-foreground" />}
          title="Bookmarks"
          emptyText="No bookmarks yet."
          isEmpty={savedBookmarks.length === 0}
        >
          {savedBookmarks.map((bookmark) => (
            <SavedLessonCard key={bookmark.id} lessonRef={bookmark}>
              <p className="text-xs text-muted-foreground">
                {bookmark.courseTitle} · {bookmark.moduleTitle}
              </p>
            </SavedLessonCard>
          ))}
        </SavedSection>

        <SavedSection
          icon={<NotebookPen className="size-4 text-muted-foreground" />}
          title="Notes"
          emptyText="No notes yet."
          isEmpty={savedNotes.length === 0}
        >
          {savedNotes.map((note) => (
            <SavedLessonCard key={note.id} lessonRef={note}>
              <p className="text-xs text-muted-foreground">
                {note.courseTitle}
              </p>
              {/* Plain text, never Markdown: shown exactly as typed. */}
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              <p
                suppressHydrationWarning
                className="text-xs text-muted-foreground"
              >
                Edited {formatRelativeTime(note.updatedAt)}
              </p>
            </SavedLessonCard>
          ))}
        </SavedSection>
      </div>
    </div>
  );
}

function SavedSection({
  icon,
  title,
  emptyText,
  isEmpty,
  children,
}: {
  icon: ReactNode;
  title: string;
  emptyText: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {isEmpty ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function SavedLessonCard({
  lessonRef,
  children,
}: {
  lessonRef: { lessonId: number; lessonTitle: string; courseSlug: string };
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <Link
          to={`/courses/${lessonRef.courseSlug}/lessons/${lessonRef.lessonId}`}
          className="text-sm font-medium hover:underline"
        >
          {lessonRef.lessonTitle}
        </Link>
        {children}
      </CardContent>
    </Card>
  );
}
