import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Bell } from "lucide-react";
import type { Feed, FeedItem } from "@knocklabs/client";
import { UserAvatar } from "~/components/user-avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn, formatRelativeTime } from "~/lib/utils";
import type { NotificationKey } from "~/lib/notification-catalogue";
import type { FeedConfig } from "~/lib/notifications.server";

// ─── Notification Feed ───
// The bell in the sidebar header. The browser polls Knock's headless feed
// (ADR 0014) with the public key and a user token signed by the server for
// the session user; the server never reads the feed. Mount it with
// key={config.knockUserId} so a DevUI user switch starts a fresh feed.
//
// Row copy is Cadence's, built from the trigger `data` keyed by workflow key;
// Knock's feed templates are not rendered.

const POLL_INTERVAL_MS = 5_000;
const PAGE_SIZE = 50;

type FeedState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: FeedItem[]; unreadCount: number };

type RowData = Record<string, string | undefined>;

const rowSentence: Record<
  NotificationKey,
  (actor: string, data: RowData) => ReactNode
> = {
  "discussion-reply": (actor, data) => (
    <>
      <b>{actor}</b> replied to your question on <b>{data.lesson_title}</b>
    </>
  ),
};

function isKnownKey(key: string): key is NotificationKey {
  return Object.hasOwn(rowSentence, key);
}

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
          unreadCount: store.metadata.unread_count,
        });
      });

      const poll = async () => {
        const result = await feed.fetch();
        if (cancelled || result?.status !== "error") return;
        // Knock may 404 for a user it has never seen: that's an empty feed.
        setState(
          isNotFound(result.data)
            ? { status: "ready", items: [], unreadCount: 0 }
            : { status: "error" }
        );
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

export function NotificationFeed({ config }: { config: FeedConfig | null }) {
  const { state, feed } = useKnockFeed(config);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const unreadCount = state.status === "ready" ? state.unreadCount : 0;
  const items =
    state.status === "ready"
      ? state.items.filter((item) => isKnownKey(item.source.key))
      : [];

  function openItem(item: FeedItem) {
    if (!item.read_at) void feed.current?.markAsRead(item);
    setOpen(false);
    const url = item.data?.url;
    if (typeof url === "string") navigate(url);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : "Notifications"
          }
          className={cn(
            "relative rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            open && "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="flex max-h-[75vh] w-96 flex-col overflow-hidden p-0"
      >
        <div className="border-b px-4 py-3 text-sm font-semibold">
          Notifications
        </div>
        {state.status === "error" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Couldn't load Notifications
          </p>
        ) : state.status === "loading" ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Notifications yet
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onOpen={() => openItem(item)} />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  onOpen,
}: {
  item: FeedItem;
  onOpen: () => void;
}) {
  const actor = item.actors[0];
  const actorName =
    actor && "name" in actor && typeof actor.name === "string"
      ? actor.name
      : "Someone";
  const avatar =
    actor && "avatar" in actor && typeof actor.avatar === "string"
      ? actor.avatar
      : null;
  const data: RowData = item.data ?? {};
  const key = item.source.key;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full gap-3 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-accent",
        !item.read_at && "bg-primary/5"
      )}
    >
      <UserAvatar
        name={actorName}
        avatarUrl={avatar}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">
          {isKnownKey(key) ? rowSentence[key](actorName, data) : null}
        </p>
        {data.excerpt && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            “{data.excerpt}”
          </p>
        )}
        <p
          className="mt-1 text-xs text-muted-foreground"
          suppressHydrationWarning
        >
          {formatRelativeTime(item.inserted_at)}
        </p>
      </div>
      {!item.read_at && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}
