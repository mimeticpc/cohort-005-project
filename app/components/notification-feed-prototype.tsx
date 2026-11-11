// PROTOTYPE, throwaway. Answers "What does the Notification Feed look like in
// Cadence?" (mimeticpc/cohort-005-project#47). Lives on
// prototype/notification-feed only; never merge.
//
// Three variants of the Notification Feed, mounted in the app layout and
// switched with ?variant= (floating bar, ← / →):
//   A  Bell popover: bell in the sidebar header, badge = unseen, opening marks
//      everything seen, clicking a row marks it read and navigates.
//   B  Drawer: "Notifications" nav item, badge = unread, right-hand slide-over
//      with Unread/All tabs, day groups, explicit actions per row.
//   C  Inbox page: "Inbox" nav item with a dot (unseen), /notifications page
//      with filters by kind, bulk select, mark read / archive.
//
// All three read the same live Knock feed from the browser with the public key
// plus a signed user token, polled every 5s.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useFetcher, useNavigate } from "react-router";
import {
  Archive,
  Bell,
  BellDot,
  Check,
  CheckCheck,
  GraduationCap,
  Inbox,
  MessageSquare,
  MessageSquareReply,
  Receipt,
  Settings,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import { Button } from "~/components/ui/button";
import type { FeedConfig } from "~/lib/notification-feed-prototype.server";

const KNOCK_API = "https://api.knock.app/v1";

// ─── Feed state ────────────────────────────────────────────────────────────

export type FeedEntry = {
  id: string;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
  archived_at: string | null;
  data: Record<string, string>;
  actors: { id: string; name?: string; avatar?: string }[];
};

type Feed = ReturnType<typeof useKnockFeed>;
const FeedContext = createContext<Feed | null>(null);

export function useFeed() {
  const feed = useContext(FeedContext);
  if (!feed) throw new Error("PROTOTYPE: useFeed outside FeedProvider");
  return feed;
}

function useKnockFeed(config: FeedConfig) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${config.publicApiKey}`,
      "X-Knock-User-Token": config.userToken,
      "Content-Type": "application/json",
    }),
    [config.publicApiKey, config.userToken]
  );

  const load = useCallback(async () => {
    const res = await fetch(
      `${KNOCK_API}/users/${config.knockUserId}/feeds/${config.feedChannelId}?page_size=50`,
      { headers }
    );
    if (res.ok) setEntries((await res.json()).entries);
  }, [config.knockUserId, config.feedChannelId, headers]);

  useEffect(() => {
    setEntries(null);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const mark = useCallback(
    async (status: "seen" | "read" | "unread" | "archived", ids: string[]) => {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      setEntries((es) =>
        (es ?? []).map((e) => {
          if (!ids.includes(e.id)) return e;
          if (status === "seen") return { ...e, seen_at: e.seen_at ?? now };
          if (status === "read") return { ...e, read_at: now, seen_at: e.seen_at ?? now };
          if (status === "unread") return { ...e, read_at: null };
          return { ...e, archived_at: now };
        })
      );
      await fetch(`${KNOCK_API}/messages/batch/${status}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message_ids: ids }),
      });
      load();
    },
    [headers, load]
  );

  const live = (entries ?? []).filter((e) => !e.archived_at);
  return {
    loading: entries === null,
    entries: live,
    unseen: live.filter((e) => !e.seen_at),
    unread: live.filter((e) => !e.read_at),
    mark,
    reload: load,
  };
}

export function FeedProvider({ config, children }: { config: FeedConfig; children: React.ReactNode }) {
  const feed = useKnockFeed(config);
  return <FeedContext.Provider value={feed}>{children}</FeedContext.Provider>;
}

// ─── Copy per Notification (Cadence owns it, not Knock's template) ─────────

type Kind =
  | "discussion-reply"
  | "discussion-question"
  | "new-enrollment"
  | "refund-requested"
  | "refund-approved"
  | "refund-declined"
  | "seat-claimed";

const KINDS: Record<Kind, { label: string; group: string; icon: React.ElementType; tone: string; cta: string }> = {
  "discussion-reply": { label: "Discussion Reply", group: "Discussion", icon: MessageSquareReply, tone: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", cta: "View reply" },
  "discussion-question": { label: "Discussion Question", group: "Discussion", icon: MessageSquare, tone: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", cta: "Answer" },
  "new-enrollment": { label: "New Enrollment", group: "Enrollments", icon: GraduationCap, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", cta: "See students" },
  "refund-requested": { label: "Refund Request", group: "Refunds", icon: Receipt, tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", cta: "Review" },
  "refund-approved": { label: "Refund approved", group: "Refunds", icon: Receipt, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", cta: "View" },
  "refund-declined": { label: "Refund declined", group: "Refunds", icon: Receipt, tone: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", cta: "View course" },
  "seat-claimed": { label: "Seat claimed", group: "Team", icon: UserPlus, tone: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", cta: "View team" },
};

function describe(e: FeedEntry) {
  const kind = (KINDS[e.data.kind as Kind] ? e.data.kind : "discussion-reply") as Kind;
  const actor = e.actors[0]?.name ?? "Someone";
  const d = e.data;
  const A = <b className="font-semibold">{actor}</b>;
  const sentence: Record<Kind, React.ReactNode> = {
    "discussion-reply": <>{A} replied to your question on <b className="font-medium">{d.lesson_title || d.question_title}</b></>,
    "discussion-question": <>{A} asked a question on <b className="font-medium">{d.lesson_title}</b></>,
    "new-enrollment": <>{A} enrolled in <b className="font-medium">{d.course_title}</b></>,
    "refund-requested": <>{A} requested a refund for <b className="font-medium">{d.course_title}</b></>,
    "refund-approved": <>Your Refund Request for <b className="font-medium">{d.course_title}</b> was approved</>,
    "refund-declined": <>Your Refund Request for <b className="font-medium">{d.course_title}</b> was declined</>,
    "seat-claimed": <>{A} claimed a Seat on <b className="font-medium">{d.course_title}</b></>,
  };
  const excerpt =
    kind === "discussion-reply" || kind === "discussion-question" ? d.question_excerpt : kind === "seat-claimed" ? d.team_name : undefined;
  return {
    kind,
    meta: KINDS[kind],
    actor,
    avatar: e.actors[0]?.avatar ?? null,
    sentence: sentence[kind],
    excerpt,
    url: d.url || d.discussion_url || "/",
  };
}

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return "Earlier";
}

function useOpenEntry() {
  const { mark } = useFeed();
  const navigate = useNavigate();
  return (e: FeedEntry, after?: () => void) => {
    if (!e.read_at) mark("read", [e.id]);
    after?.();
    navigate(describe(e).url);
  };
}

// ─── Seed button (lives in the switcher bar) ───────────────────────────────

export function SeedButton() {
  const fetcher = useFetcher<{ sent: number }>();
  const { reload } = useFeed();
  useEffect(() => {
    if (fetcher.data) setTimeout(reload, 1500);
  }, [fetcher.data, reload]);
  return (
    <fetcher.Form method="post" action="/api/prototype-notifications">
      <button className="rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-amber-300" disabled={fetcher.state !== "idle"}>
        {fetcher.state !== "idle" ? "Sending…" : fetcher.data ? `Sent ${fetcher.data.sent} · again` : "Send me demo Notifications"}
      </button>
    </fetcher.Form>
  );
}

function Empty({ text = "You're all caught up." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
      <Bell className="size-6 opacity-40" />
      {text}
    </div>
  );
}

// ─── Variant A: Bell popover ───────────────────────────────────────────────

export function VariantABell() {
  const feed = useFeed();
  const open = useOpenEntry();
  const [isOpen, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = feed.unseen.length;

  useEffect(() => {
    if (!isOpen) return;
    feed.mark("seen", feed.unseen.map((e) => e.id));
    function onDown(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className={cn(
          "relative rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed left-[13.5rem] top-2 z-50 flex max-h-[75vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <button
              className="text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
              disabled={feed.unread.length === 0}
              onClick={() => feed.mark("read", feed.unread.map((e) => e.id))}
            >
              Mark all as read
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {feed.entries.length === 0 && <Empty />}
            {feed.entries.map((e) => {
              const n = describe(e);
              return (
                <li key={e.id}>
                  <button
                    onClick={() => open(e, () => setOpen(false))}
                    className={cn(
                      "flex w-full gap-3 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-accent",
                      !e.read_at && "bg-primary/5"
                    )}
                  >
                    <UserAvatar name={n.actor} avatarUrl={n.avatar} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug">{n.sentence}</p>
                      {n.excerpt && <p className="mt-0.5 truncate text-xs text-muted-foreground">“{n.excerpt}”</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{ago(e.inserted_at)}</p>
                    </div>
                    {!e.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Link
            to="/settings#notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings className="size-3.5" /> Notification settings
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Variant B: Drawer ─────────────────────────────────────────────────────

export function VariantBNavItem() {
  const feed = useFeed();
  const [isOpen, setOpen] = useState(false);
  const count = feed.unread.length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isOpen
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Bell className="size-4" />
        Notifications
        {count > 0 && (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {count}
          </span>
        )}
      </button>
      {isOpen && <Drawer onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const feed = useFeed();
  const open = useOpenEntry();
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setShown(true));
    feed.mark("seen", feed.unseen.map((e) => e.id));
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = tab === "unread" ? feed.unread : feed.entries;
  const groups = list.reduce<Record<string, FeedEntry[]>>((acc, e) => {
    (acc[dayGroup(e.inserted_at)] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50">
      <div className={cn("absolute inset-0 bg-black/30 transition-opacity", shown ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <aside
        className={cn(
          "absolute inset-y-0 right-0 flex w-[460px] max-w-full flex-col border-l bg-background shadow-2xl transition-transform duration-200",
          shown ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <div className="flex items-center gap-1">
            <Link to="/settings#notifications" onClick={onClose} title="Notification settings" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
              <Settings className="size-4" />
            </Link>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between border-b px-5">
          <div className="flex gap-4">
            {(["unread", "all"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 py-3 text-sm font-medium capitalize",
                  tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
                {t === "unread" && feed.unread.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{feed.unread.length}</span>}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={feed.unread.length === 0}
            onClick={() => feed.mark("read", feed.unread.map((e) => e.id))}
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {list.length === 0 && <Empty text={tab === "unread" ? "No unread Notifications." : undefined} />}
          {["Today", "Yesterday", "Earlier"].map(
            (g) =>
              groups[g] && (
                <section key={g} className="mb-3">
                  <h3 className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</h3>
                  <ul className="space-y-1">
                    {groups[g].map((e) => {
                      const n = describe(e);
                      const Icon = n.meta.icon;
                      return (
                        <li key={e.id} className="group relative flex gap-3 rounded-lg p-3 hover:bg-accent/60">
                          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", n.meta.tone)}>
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm leading-snug", e.read_at && "text-muted-foreground")}>{n.sentence}</p>
                            {n.excerpt && (
                              <p className="mt-1 line-clamp-2 border-l-2 pl-2 text-xs text-muted-foreground">{n.excerpt}</p>
                            )}
                            <div className="mt-2 flex items-center gap-3">
                              <Button size="xs" variant={e.read_at ? "outline" : "default"} onClick={() => open(e, onClose)}>
                                {n.meta.cta}
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                {n.meta.label} · {ago(e.inserted_at)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {!e.read_at && <span className="mt-1.5 size-2 rounded-full bg-primary group-hover:hidden" />}
                            <div className="hidden gap-0.5 group-hover:flex">
                              <button
                                title={e.read_at ? "Mark unread" : "Mark read"}
                                onClick={() => feed.mark(e.read_at ? "unread" : "read", [e.id])}
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              >
                                {e.read_at ? <BellDot className="size-3.5" /> : <Check className="size-3.5" />}
                              </button>
                              <button
                                title="Archive"
                                onClick={() => feed.mark("archived", [e.id])}
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              >
                                <Archive className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Variant C: Inbox page ─────────────────────────────────────────────────

export function VariantCNavItem() {
  const feed = useFeed();
  return (
    <NavLink
      to="/notifications"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <span className="relative">
        <Inbox className="size-4" />
        {feed.unseen.length > 0 && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-600 ring-2 ring-sidebar" />}
      </span>
      Inbox
      {feed.unread.length > 0 && <span className="ml-auto text-xs text-sidebar-foreground/50">{feed.unread.length}</span>}
    </NavLink>
  );
}

const GROUPS = ["All", "Discussion", "Enrollments", "Refunds", "Team"];

export function VariantCInboxPage() {
  const feed = useFeed();
  const open = useOpenEntry();
  const [group, setGroup] = useState("All");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Visiting the page marks everything seen (clears the nav dot), not read.
  const unseenIds = feed.unseen.map((e) => e.id).join(",");
  useEffect(() => {
    if (unseenIds) feed.mark("seen", unseenIds.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenIds]);

  const list = feed.entries.filter(
    (e) => (group === "All" || describe(e).meta.group === group) && (!unreadOnly || !e.read_at)
  );
  const counts = Object.fromEntries(
    GROUPS.map((g) => [g, feed.unread.filter((e) => g === "All" || describe(e).meta.group === g).length])
  );
  const sel = [...selected].filter((id) => list.some((e) => e.id === id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Everything that happened while you were away.</p>
        </div>
        <Link to="/settings#notifications" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Settings className="size-4" /> Notification settings
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              group === g ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            {g}
            {counts[g] > 0 && <span className="ml-1.5 opacity-70">{counts[g]}</span>}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="flex h-11 items-center gap-3 border-b bg-muted/40 px-4 text-sm">
          <input
            type="checkbox"
            checked={sel.length > 0 && sel.length === list.length}
            onChange={(ev) => setSelected(ev.target.checked ? new Set(list.map((e) => e.id)) : new Set())}
          />
          {sel.length > 0 ? (
            <>
              <span className="text-muted-foreground">{sel.length} selected</span>
              <Button size="xs" variant="outline" onClick={() => { feed.mark("read", sel); setSelected(new Set()); }}>
                <Check className="size-3" /> Mark read
              </Button>
              <Button size="xs" variant="outline" onClick={() => { feed.mark("unread", sel); setSelected(new Set()); }}>
                <BellDot className="size-3" /> Mark unread
              </Button>
              <Button size="xs" variant="outline" onClick={() => { feed.mark("archived", sel); setSelected(new Set()); }}>
                <Archive className="size-3" /> Archive
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">{list.length} Notifications</span>
          )}
        </div>
        {feed.loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : list.length === 0 ? (
          <Empty />
        ) : (
          <ul>
            {list.map((e) => {
              const n = describe(e);
              return (
                <li
                  key={e.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0 hover:bg-accent/60",
                    !e.read_at && "bg-primary/[0.04]"
                  )}
                  onClick={() => open(e)}
                >
                  <input type="checkbox" checked={selected.has(e.id)} onClick={(ev) => ev.stopPropagation()} onChange={() => toggle(e.id)} />
                  <span className={cn("size-2 shrink-0 rounded-full", e.read_at ? "bg-transparent" : "bg-primary")} />
                  <span className={cn("w-36 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium", n.meta.tone)}>{n.meta.label}</span>
                  <span className={cn("min-w-0 flex-1 truncate", e.read_at && "text-muted-foreground")}>
                    {n.sentence}
                    {n.excerpt && <span className="text-muted-foreground"> — {n.excerpt}</span>}
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{ago(e.inserted_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
