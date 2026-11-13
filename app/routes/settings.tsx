import { useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/settings";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { UserRole, RefundStatus, users } from "~/db/schema";
import { AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { formatPrice } from "~/lib/utils";
import { listRefundRequestsForBuyer } from "~/lib/refunds.server";
import {
  loadPreferences,
  savePreference,
  type PreferenceRow,
} from "~/lib/notification-preferences.server";
import { Switch } from "~/components/ui/switch";
import {
  isNotificationKey,
  type NotificationKey,
} from "~/lib/notification-catalogue";

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  bio: z.string().trim().optional(),
});

const PREFERENCE_INTENT = "notification-preference";

const preferenceSchema = z.object({
  key: z.custom<NotificationKey>(isNotificationKey),
  feed: z.enum(["true", "false"]),
  email: z.enum(["true", "false"]),
});

export function meta() {
  return [
    { title: "Settings — Cadence" },
    { name: "description", content: "Edit your profile details" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to edit your details.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const refundRequests = listRefundRequestsForBuyer(db, currentUserId);
  const preferences = await loadPreferences(db, currentUserId);

  return {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      bio: currentUser.bio,
      role: currentUser.role,
    },
    refundRequests,
    preferences,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();
  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const formData = await request.formData();

  if (formData.get("intent") === PREFERENCE_INTENT) {
    const preference = parseFormData(formData, preferenceSchema);
    if (!preference.success) return { ok: false as const };
    const { key, feed, email } = preference.data;
    return savePreference(db, currentUser.id, key, {
      feed: feed === "true",
      email: email === "true",
    });
  }

  const parsed = parseFormData(formData, settingsSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const { name, bio } = parsed.data;

  db
    .update(users)
    .set({ name, email: currentUser.email, bio: bio || null })
    .where(eq(users.id, currentUser.id))
    .returning()
    .get();
  return { success: true };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, refundRequests, preferences } = loaderData;
  const openCount = refundRequests.filter(
    (refundRequest) => refundRequest.status === RefundStatus.Open
  ).length;
  const fetcher = useFetcher();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Profile updated successfully.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as string | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Update your profile details
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Profile</h2>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                ref={nameInputRef}
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            {user.role === UserRole.Instructor && (
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  defaultValue={user.bio ?? ""}
                  placeholder="Tell students about yourself..."
                />
                <p className="text-xs text-muted-foreground">
                  Your bio is shown on your course pages.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>

      <NotificationsCard preferences={preferences} />

      {refundRequests.length > 0 && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Refund Requests</h2>
            {openCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {openCount === 1
                  ? "One refund request is waiting on us."
                  : `${openCount} refund requests are waiting on us.`}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {refundRequests.map((refundRequest) => (
              <div key={refundRequest.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/courses/${refundRequest.courseSlug}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.courseTitle}
                  </Link>
                  <RefundStatusBadge status={refundRequest.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(refundRequest.amountPaid)} · raised{" "}
                  {new Date(refundRequest.requestedAt).toLocaleDateString()}
                  {refundRequest.resolvedAt && (
                    <>
                      {" "}
                      · decided{" "}
                      {new Date(refundRequest.resolvedAt).toLocaleDateString()}
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm">{refundRequest.reason}</p>
                {refundRequest.decisionNote && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                    <span className="font-medium">Our note: </span>
                    {refundRequest.decisionNote}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotificationsCard({
  preferences,
}: {
  preferences: PreferenceRow[] | null;
}) {
  const hasEmail =
    preferences?.some((row) => row.channels.email !== undefined) ?? false;
  return (
    <Card id="notifications" className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose where each Notification reaches you.
        </p>
      </CardHeader>
      <CardContent>
        {preferences === null ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load your Notification Preferences. Try again later.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
              <span className="flex-1">Notification</span>
              <span className="w-12 text-center">Feed</span>
              {hasEmail && <span className="w-12 text-center">Email</span>}
            </div>
            {preferences.map((row) => (
              <PreferenceToggles key={row.key} row={row} hasEmail={hasEmail} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// One row of Notification Preference toggles. Each flip saves right away;
// the switches show the submitted values until the save settles, then the
// saved values (or, after a failure, the stored ones again).
function PreferenceToggles({
  row,
  hasEmail,
}: {
  row: PreferenceRow;
  hasEmail: boolean;
}) {
  const fetcher = useFetcher<typeof action>({ key: `preference-${row.key}` });
  const result =
    fetcher.data && "ok" in fetcher.data ? fetcher.data : undefined;

  useEffect(() => {
    if (fetcher.state === "idle" && result && !result.ok) {
      toast.error(`Couldn't save your preference for ${row.name}.`);
    }
  }, [fetcher.state, result, row.name]);

  const pending = fetcher.formData;
  const current = pending
    ? {
        feed: pending.get("feed") === "true",
        email: pending.get("email") === "true",
      }
    : result?.ok
      ? { feed: result.channels.in_app_feed, email: result.channels.email }
      : {
          feed: row.channels.in_app_feed ?? false,
          email: row.channels.email ?? false,
        };
  const hasEmailChannel = row.channels.email !== undefined;

  function save(next: { feed: boolean; email: boolean }) {
    fetcher.submit(
      {
        intent: PREFERENCE_INTENT,
        key: row.key,
        feed: String(next.feed),
        // Email is forced off while the feed is off.
        email: String(next.feed && next.email),
      },
      { method: "post" }
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="flex-1 text-sm">{row.name}</span>
      <span className="flex w-12 justify-center">
        <Switch
          aria-label={`${row.name} in the Notification Feed`}
          checked={current.feed}
          // Turning the feed on doesn't turn email on.
          onCheckedChange={(feed) =>
            save({ feed, email: feed ? current.email : false })
          }
        />
      </span>
      {hasEmail && (
        <span className="flex w-12 justify-center">
          {hasEmailChannel ? (
            <Switch
              aria-label={`${row.name} by email`}
              checked={current.feed && current.email}
              disabled={!current.feed}
              onCheckedChange={(email) => save({ feed: current.feed, email })}
            />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
      )}
    </div>
  );
}

const REFUND_STATUS_BADGES: Record<
  RefundStatus,
  { label: string; className: string }
> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-muted text-muted-foreground",
  },
};

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const badge = REFUND_STATUS_BADGES[status];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 404) {
      title = "User not found";
      message =
        typeof error.data === "string" ? error.data : "User not found.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
