import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bell, Check, CheckCheck, Circle, Settings } from "lucide-react";
import type { Feed, FeedItem } from "@knocklabs/client";
import { UserAvatar } from "~/components/user-avatar";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import {
  badgeLabel,
  feedRow,
  sentenceText,
  timeAgo,
  type FeedRow,
} from "~/lib/notification-feed-rows";
import type { FeedConfig } from "~/lib/notifications.server";

// ─── Notification Feed ───
// The bell in the sidebar header. The browser polls Knock's headless feed
// (ADR 0014) with the public key and a user token signed by the server for
// the session user; the server never reads the feed. Mount it with
// key={config.knockUserId} so a DevUI user switch starts a fresh feed.
//
// The badge counts unseen Notifications; opening the popover marks them all
// seen. Read is separate: a row click, the hover toggle or "Mark all as
// read". Row copy, CTA label and target come from notification-feed-rows.ts.

const POLL_INTERVAL_MS = 5_000;
const PAGE_SIZE = 50;
// Ask the server for a new token this long before the current one expires.
const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;

type FeedState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: FeedItem[];
      unseenCount: number;
      unreadCount: number;
    };

const emptyFeed: FeedState = {
  status: "ready",
  items: [],
  unseenCount: 0,
  unreadCount: 0,
};

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 404
  );
}

// A fresh token for the same user, or nothing (the old one then expires and
// the popover shows the error until the next navigation re-signs it).
async function refreshUserToken(knockUserId: string) {
  try {
    const response = await fetch("/api/notification-token");
    if (!response.ok) return;
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "knockUserId" in body &&
      body.knockUserId === knockUserId &&
      "userToken" in body &&
      typeof body.userToken === "string"
    ) {
      return body.userToken;
    }
  } catch {
    // Network error: keep the current token.
  }
}

function useKnockFeed(config: FeedConfig | null) {
  const [state, setState] = useState<FeedState>(
    config ? { status: "loading" } : { status: "error" }
  );
  const feedRef = useRef<Feed | null>(null);

  // Restart only when the user or Knock config changes, not when the layout
  // loader re-signs the token on navigation.
  const configRef = useRef(config);
  configRef.current = config;
  const configKey = config
    ? `${config.knockUserId}|${config.publicApiKey}|${config.feedChannelId}`
    : null;

  useEffect(() => {
    const config = configRef.current;
    if (!config) return;
    let cancelled = false;
    let teardown = () => {};

    async function start(config: FeedConfig) {
      // Client-only: keeps the browser SDK out of the server bundle.
      const { default: Knock } = await import("@knocklabs/client");
      if (cancelled) return;

      const knock = new Knock(config.publicApiKey);
      // "skip": only the server identifies users (on trigger).
      knock.authenticate({ id: config.knockUserId }, config.userToken, {
        identificationStrategy: "skip",
        onUserTokenExpiring: () => refreshUserToken(config.knockUserId),
        timeBeforeExpirationInMs: TOKEN_REFRESH_LEAD_MS,
      });
      const feed = knock.feeds.initialize(config.feedChannelId, {
        page_size: PAGE_SIZE,
        archived: "exclude",
      });
      feedRef.current = feed;

      const unsubscribe = feed.store.subscribe((store) => {
        if (store.networkStatus === "error") return;
        setState({
          status: "ready",
          items: store.items,
          unseenCount: store.metadata.unseen_count,
          unreadCount: store.metadata.unread_count,
        });
      });

      const poll = async () => {
        const result = await feed.fetch();
        if (cancelled || result?.status !== "error") return;
        // Knock may 404 for a user it has never seen: that's an empty feed.
        setState(isNotFound(result.data) ? emptyFeed : { status: "error" });
      };

      void poll();
      const interval = setInterval(poll, POLL_INTERVAL_MS);

      teardown = () => {
        clearInterval(interval);
        unsubscribe();
        feed.dispose();
        knock.teardown();
        feedRef.current = null;
      };
    }

    start(config).catch(() => {
      if (!cancelled) setState({ status: "error" });
    });

    return () => {
      cancelled = true;
      teardown();
    };
  }, [configKey]);

  return { state, feed: feedRef };
}

// Status writes are optimistic in the store; a failure is put right by the
// next poll.
function ignoreFailure(write: Promise<unknown> | undefined) {
  void write?.catch(() => {});
}

export function NotificationFeed({ config }: { config: FeedConfig | null }) {
  const { state, feed } = useKnockFeed(config);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const ready = state.status === "ready" ? state : null;
  const badge = badgeLabel(ready?.unseenCount ?? 0);
  const rows = (ready?.items ?? []).flatMap((item) => {
    const row = feedRow(item);
    return row ? [{ item, row }] : [];
  });
  const hasUnread = rows.some(({ row }) => row.unread);

  // Opening the popover marks everything seen (not read), and so does a new
  // Notification arriving while it is open.
  const unseenCount = ready?.unseenCount ?? 0;
  useEffect(() => {
    if (open && unseenCount > 0) ignoreFailure(feed.current?.markAllAsSeen());
  }, [open, unseenCount, feed]);

  function openRow(item: FeedItem, row: FeedRow) {
    if (row.unread) ignoreFailure(feed.current?.markAsRead(item));
    setOpen(false);
    if (row.target) navigate(row.target);
  }

  function toggleRead(item: FeedItem, row: FeedRow) {
    ignoreFailure(
      row.unread
        ? feed.current?.markAsRead(item)
        : feed.current?.markAsUnread(item)
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            badge ? `Notifications (${badge} unseen)` : "Notifications"
          }
          className={cn(
            "relative rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            open && "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <Bell className="size-5" />
          {badge && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="flex max-h-[75vh] w-96 flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!hasUnread}
            onClick={() => ignoreFailure(feed.current?.markAllAsRead())}
          >
            <CheckCheck />
            Mark all as read
          </Button>
        </div>
        {state.status === "error" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Couldn't load Notifications
          </p>
        ) : state.status === "loading" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Notifications yet
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {rows.map(({ item, row }) => (
              <li key={item.id}>
                <NotificationRow
                  row={row}
                  insertedAt={item.inserted_at}
                  onOpen={() => openRow(item, row)}
                  onToggleRead={() => toggleRead(item, row)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2">
          <Link
            to="/settings#notifications"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Settings className="size-3.5" />
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  row,
  insertedAt,
  onOpen,
  onToggleRead,
}: {
  row: FeedRow;
  insertedAt: string;
  onOpen: () => void;
  onToggleRead: () => void;
}) {
  return (
    // The whole row opens the Notification; the CTA button is its keyboard
    // and screen-reader route.
    <div
      onClick={onOpen}
      className={cn(
        "group relative flex cursor-pointer gap-3 border-b px-4 py-3 text-sm transition-colors hover:bg-accent",
        row.unread && "bg-primary/5"
      )}
    >
      <UserAvatar
        name={row.actorName}
        avatarUrl={row.avatarUrl}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          {row.sentence.map((part, index) =>
            part.bold ? <b key={index}>{part.text}</b> : part.text
          )}
        </p>
        {row.excerpt && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            “{row.excerpt}”
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span
            className="text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            {timeAgo(insertedAt)}
          </span>
          <Button
            variant="outline"
            size="xs"
            aria-label={`${row.ctaLabel}: ${sentenceText(row.sentence)}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {row.ctaLabel}
          </Button>
        </div>
      </div>
      {/* Unread dot, swapped for the read/unread toggle on hover or focus. */}
      <div className="relative mt-0.5 size-5 shrink-0">
        {row.unread && (
          <span
            aria-hidden
            className="absolute left-1.5 top-1.5 size-2 rounded-full bg-primary group-focus-within:hidden group-hover:hidden"
          />
        )}
        <button
          type="button"
          title={row.unread ? "Mark as read" : "Mark as unread"}
          aria-label={row.unread ? "Mark as read" : "Mark as unread"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleRead();
          }}
          className="absolute inset-0 flex items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          {row.unread ? (
            <Check className="size-3.5" />
          ) : (
            <Circle className="size-3" />
          )}
        </button>
      </div>
    </div>
  );
}
