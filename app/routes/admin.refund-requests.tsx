import { useEffect } from "react";
import { useFetcher, data, isRouteErrorResponse, Link } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin.refund-requests";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { db } from "~/db";
import { RefundRequestStatus, UserRole, users } from "~/db/schema";
import {
  REFUND_WATCH_LIMIT_SECONDS,
  buildRefundRequestResolvedEmail,
  listRefundRequestsForAdmin,
  resolveRefundRequest,
} from "~/lib/refunds.server";
import { cn, formatPrice } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, ReceiptText } from "lucide-react";

const statusFilterSchema = z.object({
  status: z.nativeEnum(RefundRequestStatus).catch(RefundRequestStatus.Open),
});

const resolveSchema = z.object({
  refundRequestId: z.coerce.number().int(),
  decision: z.enum(["approve", "decline"]),
});

const STATUS_LABELS: Record<RefundRequestStatus, string> = {
  [RefundRequestStatus.Open]: "Open",
  [RefundRequestStatus.Approved]: "Approved",
  [RefundRequestStatus.Declined]: "Declined",
};

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Admins can Resolve Refund Requests.", { status: 403 });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const { status } = statusFilterSchema.parse({
    status: url.searchParams.get("status") ?? undefined,
  });

  return {
    status,
    refundRequests: listRefundRequestsForAdmin(db, status),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, resolveSchema);

  if (!parsed.success) {
    throw data("Invalid Refund Request decision.", { status: 400 });
  }

  const result = resolveRefundRequest(
    db,
    parsed.data.refundRequestId,
    admin.id,
    parsed.data.decision
  );

  switch (result.outcome) {
    case "not-found":
      throw data("Refund Request not found.", { status: 404 });
    case "already-resolved":
      throw data(
        `Already Resolved as ${STATUS_LABELS[result.status]}${result.resolvedByName ? ` by ${result.resolvedByName}` : ""}.`,
        { status: 409 }
      );
    case "seat-claimed":
      throw data(
        "A team seat from this Purchase has been claimed, so it cannot be refunded.",
        { status: 409 }
      );
    case "resolved": {
      const email = buildRefundRequestResolvedEmail(result);
      console.log(
        `[email] to=${email.to} subject=${email.subject}\n${email.body}`
      );
      return { resolvedAs: result.status };
    }
  }
}

function formatWatched(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function daysBetween(fromIso: string, toIso: string) {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

function statusBadge(status: RefundRequestStatus) {
  const styles: Record<RefundRequestStatus, string> = {
    [RefundRequestStatus.Open]:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    [RefundRequestStatus.Approved]:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    [RefundRequestStatus.Declined]:
      "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { status, refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline what Learners have asked for. A resolution is
          final.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        {Object.values(RefundRequestStatus).map((option) => (
          <Link
            key={option}
            to={`?status=${option}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              option === status
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {STATUS_LABELS[option]}
          </Link>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ReceiptText className="mb-3 size-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              No {STATUS_LABELS[status]} Refund Requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["refundRequests"][number];

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: RefundRequestRow;
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const isOpen = refundRequest.status === RefundRequestStatus.Open;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.resolvedAs) {
      toast.success(
        `Refund Request ${STATUS_LABELS[fetcher.data.resolvedAs].toLowerCase()}.`
      );
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{refundRequest.learnerName}</p>
            <p className="text-sm text-muted-foreground">
              {refundRequest.learnerEmail}
            </p>
          </div>
          {statusBadge(refundRequest.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Course</dt>
            <dd>
              <Link
                to={`/courses/${refundRequest.courseSlug}`}
                className="hover:underline"
              >
                {refundRequest.courseTitle}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Amount paid</dt>
            <dd>{formatPrice(refundRequest.amountPaid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Purchased</dt>
            <dd>
              {new Date(refundRequest.purchasedAt).toLocaleDateString()} (
              {daysBetween(refundRequest.purchasedAt, refundRequest.requestedAt)}{" "}
              days before asking)
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requested</dt>
            <dd>{new Date(refundRequest.requestedAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Watched</dt>
            <dd>{formatWatched(refundRequest.watchedSeconds)}</dd>
          </div>
          {refundRequest.resolvedAt && (
            <div>
              <dt className="text-muted-foreground">Resolved</dt>
              <dd>
                {new Date(refundRequest.resolvedAt).toLocaleDateString()}
                {refundRequest.resolvedByName &&
                  ` by ${refundRequest.resolvedByName}`}
              </dd>
            </div>
          )}
          {refundRequest.refundStatus && (
            <div>
              <dt className="text-muted-foreground">Refund</dt>
              <dd className="capitalize">{refundRequest.refundStatus}</dd>
            </div>
          )}
        </dl>

        <blockquote className="border-l-2 pl-3 text-sm">
          {refundRequest.reason}
        </blockquote>

        {isOpen && refundRequest.watchedOverLimit && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            The Learner has now watched{" "}
            {formatWatched(refundRequest.watchedSeconds)}, past the{" "}
            {formatWatched(REFUND_WATCH_LIMIT_SECONDS)} limit. You can still
            approve.
          </p>
        )}

        {isOpen && (
          <fetcher.Form method="post" className="flex items-center gap-2">
            <input
              type="hidden"
              name="refundRequestId"
              value={refundRequest.id}
            />
            <Button
              type="submit"
              name="decision"
              value="approve"
              size="sm"
              disabled={isSubmitting || refundRequest.seatClaimed}
            >
              Approve
            </Button>
            <Button
              type="submit"
              name="decision"
              value="decline"
              size="sm"
              variant="outline"
              disabled={isSubmitting}
            >
              Decline
            </Button>
            {refundRequest.seatClaimed && (
              <span className="text-xs text-muted-foreground">
                A team seat from this Purchase has been claimed, so it cannot
                be approved.
              </span>
            )}
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 409 ? "Already Resolved" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/admin/refund-requests">
          <Button>Back to Refund Requests</Button>
        </Link>
      </div>
    </div>
  );
}
