// PROTOTYPE, throwaway. Answers "What does Notification email look like?"
// (mimeticpc/cohort-005-project#51). Lives on prototype/notification-email
// only; never merge.
//
// Three email designs for the 7 v1 Notifications on one throwaway route,
// switched with ?variant=A|B|C (floating bar, ← / →). ?n= picks the
// Notification. Left: a mock inbox showing every Notification's From,
// subject and preheader for the current variant. Right: the rendered HTML in
// an iframe at desktop or phone width, plus the Liquid source.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/prototype.notification-email";
import { FIXTURES, VARIANTS, VARS, renderEmail } from "~/lib/notification-email-prototype.server";
import { PrototypeSwitcher } from "~/components/prototype-switcher";
import { cn } from "~/lib/utils";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const variant = VARIANTS.find((v) => v.key === url.searchParams.get("variant")) ?? VARIANTS[0];
  const emails = await Promise.all(
    FIXTURES.map(async (f) => ({
      kind: f.kind,
      label: f.label,
      recipientRole: f.recipientRole,
      recipient: `${f.recipient.name} <${f.recipient.email}>`,
      ...(await renderEmail(variant, f)),
    }))
  );
  return {
    variant: variant.key,
    variants: VARIANTS.map((v) => ({ key: v.key, name: v.name })),
    layout: variant.layout,
    from: VARS.from,
    emails,
  };
}

export default function NotificationEmailPrototype({ loaderData }: Route.ComponentProps) {
  const { variant, variants, emails, from, layout } = loaderData;
  const [params] = useSearchParams();
  const selected = emails.find((e) => e.kind === params.get("n")) ?? emails[0];
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [showSource, setShowSource] = useState(false);

  const href = (kind: string) => {
    const p = new URLSearchParams(params);
    p.set("n", kind);
    return `?${p}`;
  };

  return (
    <div className="flex min-h-screen bg-muted/40 text-foreground">
      <aside className="w-[420px] shrink-0 border-r bg-background">
        <div className="border-b px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Prototype · #51</div>
          <h1 className="text-lg font-semibold">Notification email</h1>
          <p className="text-xs text-muted-foreground">Inbox view: what each recipient sees before opening.</p>
        </div>
        <ul>
          {emails.map((e) => (
            <li key={e.kind}>
              <Link
                to={href(e.kind)}
                preventScrollReset
                className={cn(
                  "block border-b px-4 py-3 hover:bg-muted",
                  e.kind === selected.kind && "bg-muted ring-2 ring-inset ring-amber-400"
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">Cadence</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {e.label} → {e.recipientRole}
                  </span>
                </div>
                <div className="truncate text-sm">{e.subject}</div>
                <div className="truncate text-xs text-muted-foreground">{e.preheader}</div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3 p-4 pb-24">
        <div className="rounded-lg border bg-background p-3 text-sm">
          <div className="grid grid-cols-[80px_1fr] gap-y-1">
            <span className="text-muted-foreground">From</span>
            <span>{from}</span>
            <span className="text-muted-foreground">To</span>
            <span>{selected.recipient}</span>
            <span className="text-muted-foreground">Reply-to</span>
            <span className="text-muted-foreground italic">none (no-reply)</span>
            <span className="text-muted-foreground">Subject</span>
            <span className="font-semibold">{selected.subject}</span>
            <span className="text-muted-foreground">Preheader</span>
            <span className="text-muted-foreground">{selected.preheader}</span>
          </div>
          <div className="mt-3 flex gap-2">
            {(["desktop", "phone"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                className={cn("rounded border px-2 py-0.5 text-xs", width === w && "bg-foreground text-background")}
              >
                {w === "desktop" ? "Desktop 680px" : "Phone 375px"}
              </button>
            ))}
            <button onClick={() => setShowSource((s) => !s)} className="ml-auto rounded border px-2 py-0.5 text-xs">
              {showSource ? "Hide" : "Show"} Liquid source
            </button>
          </div>
        </div>

        <div className="flex justify-center">
          <iframe
            key={`${variant}-${selected.kind}`}
            title="Email preview"
            srcDoc={selected.html}
            className="h-[760px] rounded-lg border bg-white shadow-sm transition-[width]"
            style={{ width: width === "desktop" ? 680 : 375 }}
          />
        </div>

        {showSource && (
          <div className="grid gap-3 lg:grid-cols-2">
            <Source title="subject" text={selected.source.subject} />
            <Source title="preheader" text={selected.source.preheader} />
            <Source title={`template: ${selected.kind}`} text={selected.source.body} />
            <Source title="layout (shared by all 7)" text={layout} />
          </div>
        )}
      </main>

      <PrototypeSwitcher variants={variants} current={variant} />
    </div>
  );
}

function Source({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background">
      <div className="border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">{title}</div>
      <pre className="max-h-80 overflow-auto p-3 text-xs whitespace-pre-wrap">{text}</pre>
    </div>
  );
}
