// PROTOTYPE, throwaway. Answers "What does Notification email look like?"
// (mimeticpc/cohort-005-project#51). Lives on prototype/notification-email
// only; never merge.
//
// Three radically different email designs for the 7 v1 Notifications. Each
// variant is a Knock-shaped bundle: one email *layout* (Liquid, wraps
// `{{ content }}`) plus a subject / preheader / body *template* per
// Notification. They're rendered locally with liquidjs (Knock's template
// language is Liquid) against the same variables Knock exposes: `recipient`,
// `actor`, `data`, `vars`. Nothing is sent and nothing touches Knock.
//
//   A  Feed card   – mirrors the decided Notification Feed row: wordmark,
//                    one card with avatar + sentence + excerpt + CTA button.
//   B  Plain letter – text-first, no card, no colour, reads like a person
//                    wrote it; CTA is a text link.
//   C  Receipt     – coloured band per kind, headline, key/value details
//                    table, full-width CTA, "why you got this" box.
import { Liquid } from "liquidjs";

const liquid = new Liquid({ outputEscape: "escape" });

export const VARS = {
  app_url: "https://cadence.example",
  app_name: "Cadence",
  settings_url: "https://cadence.example/settings#notifications",
  from: "Cadence <notifications@mail.cadence.example>",
};

// ─── Sample trigger data, one per Notification in the v1 catalogue ──────────
// Names, courses and Discussion text come from the seed DB. Excerpts are
// already plain text: the real trigger must strip Markdown before sending.

export type Kind =
  | "refund-approved"
  | "refund-declined"
  | "refund-requested"
  | "seat-claimed"
  | "new-enrollment"
  | "discussion-question"
  | "discussion-reply";

type Person = { id: string; name: string; first_name: string; email: string; initials: string };
const person = (id: string, name: string, email: string): Person => ({
  id,
  name,
  first_name: name.split(" ")[0],
  email,
  initials: name
    .split(" ")
    .map((p) => p[0])
    .join(""),
});

const alex = person("1", "Alex Rivera", "alex@ralph.dev");
const sarah = person("2", "Sarah Chen", "sarah@ralph.dev");
const emma = person("5", "Emma Wilson", "emma@student.dev");
const james = person("6", "James Park", "james@student.dev");
const olivia = person("7", "Olivia Martinez", "olivia@student.dev");
const liam = person("8", "Liam Thompson", "liam@student.dev");

export type Fixture = {
  kind: Kind;
  label: string;
  recipientRole: string;
  recipient: Person;
  actor: Person;
  data: Record<string, string | number>;
};

export const FIXTURES: Fixture[] = [
  {
    kind: "discussion-reply",
    label: "Discussion Reply",
    recipientRole: "Question author",
    recipient: emma,
    actor: sarah,
    data: {
      course_title: "Introduction to TypeScript",
      lesson_title: "Your First TypeScript Program",
      question_excerpt: "I'm getting tsc: command not found when I run the compile step. Did I miss an install somewhere?",
      reply_excerpt:
        "That usually means TypeScript is installed locally but not on your PATH. Two options: npx tsc --version, or install it globally with npm i -g typescript…",
      url: "https://cadence.example/courses/introduction-to-typescript/lessons/3#comment-12",
    },
  },
  {
    kind: "discussion-question",
    label: "Discussion Question",
    recipientRole: "Instructor",
    recipient: sarah,
    actor: emma,
    data: {
      course_title: "Introduction to TypeScript",
      lesson_title: "Function Types",
      question_excerpt: "Why does this fail to infer? I expected T to come out as string. function first<T>(items: T[]): T { return items[0]; } const x = first([]);",
      url: "https://cadence.example/instructor/questions",
    },
  },
  {
    kind: "new-enrollment",
    label: "New Enrollment",
    recipientRole: "Instructor (opt-in)",
    recipient: sarah,
    actor: liam,
    data: {
      course_title: "Introduction to TypeScript",
      via: "Individual Purchase",
      student_count: 42,
      url: "https://cadence.example/instructor/1/students",
    },
  },
  {
    kind: "refund-requested",
    label: "New Open Refund Request",
    recipientRole: "Every Platform Admin",
    recipient: alex,
    actor: james,
    data: {
      course_title: "Building REST APIs with Node.js",
      amount: "$59.99",
      purchased_on: "Nov 2, 2026",
      reason: "The pace was too fast for me. I'd like to take a beginner course first.",
      url: "https://cadence.example/admin/refunds",
    },
  },
  {
    kind: "refund-approved",
    label: "Refund Request approved",
    recipientRole: "Buyer",
    recipient: james,
    actor: alex,
    data: {
      course_title: "Building REST APIs with Node.js",
      amount: "$59.99",
      purchased_on: "Nov 2, 2026",
      decision_note: "Approved. Sorry it wasn't the right fit. The beginner track starts with Introduction to TypeScript.",
      url: "https://cadence.example/dashboard",
    },
  },
  {
    kind: "refund-declined",
    label: "Refund Request declined",
    recipientRole: "Buyer",
    recipient: liam,
    actor: alex,
    data: {
      course_title: "Introduction to TypeScript",
      amount: "$79.00",
      purchased_on: "Sep 14, 2026",
      decision_note: "You've completed 9 of 10 lessons, so this Purchase doesn't qualify. If something in the course is broken, tell us and we'll take another look.",
      url: "https://cadence.example/courses/introduction-to-typescript",
    },
  },
  {
    kind: "seat-claimed",
    label: "Seat claimed",
    recipientRole: "Team Admin",
    recipient: olivia,
    actor: james,
    data: {
      course_title: "Design Systems with Tailwind",
      seats_used: 7,
      seats_total: 10,
      seats_left: 3,
      url: "https://cadence.example/team",
    },
  },
];

// ─── Templates ──────────────────────────────────────────────────────────────

type Template = { subject: string; preheader: string; body: string };
export type Variant = { key: string; name: string; layout: string; templates: Record<Kind, Template> };

const font = `font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

// Shared hidden-preheader snippet (each layout includes it differently).
const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">{{ preheader }}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`;

// ── A: Feed card ────────────────────────────────────────────────────────────

const btn = (label: string) =>
  `<a href="{{ data.url }}" style="display:inline-block;background:#171717;color:#fafafa;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${label}</a>`;

const cardRow = (sentence: string, excerpt: string | null, cta: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="44" valign="top" style="padding-right:12px">
    <div style="width:40px;height:40px;border-radius:20px;background:#e5e5e5;color:#404040;font-size:14px;font-weight:600;line-height:40px;text-align:center">{{ actor.initials }}</div>
  </td>
  <td valign="top" style="font-size:15px;line-height:22px;color:#171717">
    ${sentence}
    ${
      excerpt
        ? `<div style="margin-top:12px;padding:12px 14px;background:#f5f5f5;border-radius:8px;color:#525252;font-size:14px;line-height:20px">${excerpt}</div>`
        : ""
    }
    <div style="margin-top:20px">${btn(cta)}</div>
  </td>
</tr></table>`;

// Decided (#51): refund Notifications swap the excerpt box for C's details table.
const refundRows = (pairs: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-top:1px solid #e4e4e7">${pairs
    .map(
      ([k, v]) =>
        `<tr><td width="30%" valign="top" style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a">${k}</td><td valign="top" style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#171717">${v}</td></tr>`
    )
    .join("")}</table>`;

const A: Variant = {
  key: "A",
  name: "Feed card",
  layout: `<!doctype html><html><body style="margin:0;background:#f4f4f5;${font}">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 16px;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#171717">{{ vars.app_name }}</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:28px 24px">{{ content | raw }}</td></tr>
    <tr><td style="padding:20px 4px;font-size:12px;line-height:18px;color:#71717a">
      You're getting this email because of your <a href="{{ vars.settings_url }}" style="color:#52525b">Notification settings</a>.
      This address doesn't accept replies.
    </td></tr>
  </table>
</td></tr></table></body></html>`,
  templates: {
    "discussion-reply": {
      subject: "{{ actor.name }} replied to your question on {{ data.lesson_title }}",
      preheader: "{{ data.reply_excerpt | truncate: 90 }}",
      body: cardRow(
        `<b>{{ actor.name }}</b> replied to your question on <b>{{ data.lesson_title }}</b>`,
        `{{ data.reply_excerpt }}`,
        "View reply"
      ),
    },
    "discussion-question": {
      subject: "{{ actor.name }} asked a question on {{ data.lesson_title }}",
      preheader: "{{ data.question_excerpt | truncate: 90 }}",
      body: cardRow(
        `<b>{{ actor.name }}</b> asked a question on <b>{{ data.lesson_title }}</b>`,
        `{{ data.question_excerpt }}`,
        "Answer"
      ),
    },
    "new-enrollment": {
      subject: "{{ actor.name }} enrolled in {{ data.course_title }}",
      preheader: "{{ data.course_title }} now has {{ data.student_count }} students.",
      body: cardRow(`<b>{{ actor.name }}</b> enrolled in <b>{{ data.course_title }}</b>`, null, "See students"),
    },
    "refund-requested": {
      subject: "{{ actor.name }} requested a refund for {{ data.course_title }}",
      preheader: "{{ data.amount }} · {{ data.reason | truncate: 70 }}",
      body: cardRow(
        `<b>{{ actor.name }}</b> requested a refund for <b>{{ data.course_title }}</b>${refundRows([["Amount", "{{ data.amount }}"], ["Purchased", "{{ data.purchased_on }}"], ["Reason", "{{ data.reason }}"]])}`,
        null,
        "Review"
      ),
    },
    "refund-approved": {
      subject: "Your Refund Request for {{ data.course_title }} was approved",
      preheader: "{{ data.amount }} is on its way back to you.",
      body: cardRow(
        `Your Refund Request for <b>{{ data.course_title }}</b> was approved${refundRows([["Amount", "{{ data.amount }}"], ["Purchased", "{{ data.purchased_on }}"], ["Note", "{% if data.decision_note %}{{ data.decision_note }}{% else %}—{% endif %}"]])}`,
        null,
        "View"
      ),
    },
    "refund-declined": {
      subject: "Your Refund Request for {{ data.course_title }} was declined",
      preheader: "{{ data.decision_note | truncate: 90 }}",
      body: cardRow(
        `Your Refund Request for <b>{{ data.course_title }}</b> was declined${refundRows([["Amount", "{{ data.amount }}"], ["Purchased", "{{ data.purchased_on }}"], ["Note", "{{ data.decision_note }}"]])}<div style="font-size:14px;color:#525252">You can ask again from the course page.</div>`,
        null,
        "View course"
      ),
    },
    "seat-claimed": {
      subject: "{{ actor.name }} claimed a Seat on {{ data.course_title }}",
      preheader: "{{ data.seats_left }} of {{ data.seats_total }} Seats left.",
      body: cardRow(
        `<b>{{ actor.name }}</b> claimed a Seat on <b>{{ data.course_title }}</b>`,
        `{{ data.seats_left }} of {{ data.seats_total }} Seats left`,
        "View team"
      ),
    },
  },
};

// ── B: Plain letter ─────────────────────────────────────────────────────────

const quote = (text: string) =>
  `<blockquote style="margin:16px 0;padding:0 0 0 14px;border-left:3px solid #d4d4d4;color:#525252">${text}</blockquote>`;
const link = (label: string) => `<p style="margin:16px 0"><a href="{{ data.url }}" style="color:#2563eb">${label} →</a></p>`;
const hi = `<p style="margin:0 0 16px">Hi {{ recipient.first_name }},</p>`;

const B: Variant = {
  key: "B",
  name: "Plain letter",
  layout: `<!doctype html><html><body style="margin:0;background:#ffffff">${preheader}
<div style="max-width:600px;padding:24px 20px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:26px;color:#262626">
{{ content | raw }}
<p style="margin:24px 0 0">— {{ vars.app_name }}</p>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:32px 0 12px">
<p style="margin:0;${font};font-size:12px;line-height:18px;color:#737373">Sent from a no-reply address. Choose which emails you get in <a href="{{ vars.settings_url }}" style="color:#737373">Notification settings</a>.</p>
</div></body></html>`,
  templates: {
    "discussion-reply": {
      subject: "New reply on “{{ data.lesson_title }}”",
      preheader: "{{ actor.name }}: {{ data.reply_excerpt | truncate: 80 }}",
      body: `${hi}<p style="margin:0">{{ actor.name }} replied to the question you asked on <i>{{ data.lesson_title }}</i> in {{ data.course_title }}:</p>${quote(
        "{{ data.reply_excerpt }}"
      )}${link("Read the whole reply")}`,
    },
    "discussion-question": {
      subject: "New question on “{{ data.lesson_title }}”",
      preheader: "{{ actor.name }}: {{ data.question_excerpt | truncate: 80 }}",
      body: `${hi}<p style="margin:0">{{ actor.name }} asked a question on <i>{{ data.lesson_title }}</i> in {{ data.course_title }}:</p>${quote(
        "{{ data.question_excerpt }}"
      )}${link("Answer it in Cadence")}`,
    },
    "new-enrollment": {
      subject: "New student in {{ data.course_title }}",
      preheader: "{{ actor.name }} just enrolled.",
      body: `${hi}<p style="margin:0">{{ actor.name }} just enrolled in {{ data.course_title }} through {% if data.via == "Claimed Seat" %}a Claimed Seat{% else %}an Individual Purchase{% endif %}. That makes {{ data.student_count }} students.</p>${link(
        "See your students"
      )}<p style="margin:16px 0 0;font-size:14px;color:#737373">You turned these emails on. You can turn them off in Notification settings.</p>`,
    },
    "refund-requested": {
      subject: "Refund Request: {{ data.course_title }} ({{ data.amount }})",
      preheader: "{{ actor.name }}: {{ data.reason | truncate: 80 }}",
      body: `${hi}<p style="margin:0">{{ actor.name }} asked for a refund of {{ data.amount }} for {{ data.course_title }}, bought on {{ data.purchased_on }}. Their reason:</p>${quote(
        "{{ data.reason }}"
      )}${link("Review Refund Requests")}`,
    },
    "refund-approved": {
      subject: "Your refund for {{ data.course_title }} was approved",
      preheader: "{{ data.amount }} is on its way back to you.",
      body: `${hi}<p style="margin:0">Good news: we approved your Refund Request for {{ data.course_title }}. {{ data.amount }} is on its way back to the card you paid with.</p>{% if data.decision_note %}${quote(
        "{{ data.decision_note }}"
      )}{% endif %}${link("Go to your dashboard")}`,
    },
    "refund-declined": {
      subject: "About your refund for {{ data.course_title }}",
      preheader: "{{ data.decision_note | truncate: 90 }}",
      body: `${hi}<p style="margin:0">We looked at your Refund Request for {{ data.course_title }} and can't approve it this time. Here's why:</p>${quote(
        "{{ data.decision_note }}"
      )}<p style="margin:0">You can still ask again from the course page.</p>${link("Go to the course")}`,
    },
    "seat-claimed": {
      subject: "{{ actor.first_name }} joined {{ data.course_title }}",
      preheader: "{{ data.seats_left }} Seats left on your Team Licence.",
      body: `${hi}<p style="margin:0">{{ actor.name }} claimed a Seat on your Team Licence for {{ data.course_title }}. {{ data.seats_used }} of {{ data.seats_total }} Seats are taken, so {{ data.seats_left }} are left.</p>${link(
        "Manage your team"
      )}`,
    },
  },
};

// ── C: Receipt ──────────────────────────────────────────────────────────────

const tone = {
  discussion: { band: "#0369a1", soft: "#e0f2fe" },
  enrollment: { band: "#047857", soft: "#d1fae5" },
  refundOpen: { band: "#b45309", soft: "#fef3c7" },
  refundYes: { band: "#047857", soft: "#d1fae5" },
  refundNo: { band: "#be123c", soft: "#ffe4e6" },
  team: { band: "#6d28d9", soft: "#ede9fe" },
};

const rows = (pairs: [string, string][]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #e4e4e7">${pairs
    .map(
      ([k, v]) =>
        `<tr><td width="34%" valign="top" style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a">${k}</td><td valign="top" style="padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b">${v}</td></tr>`
    )
    .join("")}</table>`;

const receipt = (t: { band: string; soft: string }, eyebrow: string, headline: string, details: string, cta: string, why: string) => `
<div style="background:${t.band};padding:20px 28px;color:#ffffff">
  <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">${eyebrow}</div>
  <div style="margin-top:6px;font-size:22px;line-height:28px;font-weight:700">${headline}</div>
</div>
<div style="padding:8px 28px 28px">
  ${details}
  <a href="{{ data.url }}" style="display:block;text-align:center;background:${t.band};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px;border-radius:8px">${cta}</a>
  <div style="margin-top:24px;padding:12px 14px;background:${t.soft};border-radius:8px;font-size:13px;line-height:19px;color:#3f3f46"><b>Why you got this:</b> ${why}</div>
</div>`;

const C: Variant = {
  key: "C",
  name: "Receipt",
  layout: `<!doctype html><html><body style="margin:0;background:#e4e4e7;${font}">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:4px;overflow:hidden">
    <tr><td style="padding:14px 28px;background:#18181b;color:#fafafa;font-size:15px;font-weight:700">◆ {{ vars.app_name }}</td></tr>
    <tr><td>{{ content | raw }}</td></tr>
    <tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;line-height:18px;color:#71717a">
      <a href="{{ vars.settings_url }}" style="color:#3f3f46;font-weight:600">Notification settings</a> &nbsp;·&nbsp; <a href="{{ vars.app_url }}" style="color:#3f3f46">Open Cadence</a><br>
      This is an automated message from a no-reply address. Replies aren't read.
    </td></tr>
  </table>
</td></tr></table></body></html>`,
  templates: {
    "discussion-reply": {
      subject: "[Cadence] Reply: {{ data.lesson_title }}",
      preheader: "{{ actor.name }} replied to your question.",
      body: receipt(
        tone.discussion,
        "Discussion Reply",
        "{{ actor.name }} replied to your question",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Lesson", "{{ data.lesson_title }}"],
          ["You asked", "<span style='color:#71717a'>{{ data.question_excerpt | truncate: 80 }}</span>"],
          ["Reply", "{{ data.reply_excerpt }}"],
        ]),
        "View reply",
        "you asked this question. You won't get emails for other replies in the thread."
      ),
    },
    "discussion-question": {
      subject: "[Cadence] Question: {{ data.lesson_title }}",
      preheader: "{{ actor.name }} asked a question in {{ data.course_title }}.",
      body: receipt(
        tone.discussion,
        "Discussion Question",
        "{{ actor.name }} asked a question",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Lesson", "{{ data.lesson_title }}"],
          ["Question", "{{ data.question_excerpt }}"],
        ]),
        "Answer",
        "you're the Instructor of {{ data.course_title }}."
      ),
    },
    "new-enrollment": {
      subject: "[Cadence] New Enrollment: {{ data.course_title }}",
      preheader: "{{ actor.name }} enrolled. {{ data.student_count }} students total.",
      body: receipt(
        tone.enrollment,
        "New Enrollment",
        "{{ actor.name }} enrolled",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Via", "{{ data.via }}"],
          ["Students", "{{ data.student_count }}"],
        ]),
        "See students",
        "you turned on New Enrollment emails for courses you teach."
      ),
    },
    "refund-requested": {
      subject: "[Cadence] Refund Request: {{ data.course_title }} · {{ data.amount }}",
      preheader: "{{ actor.name }} is asking for a refund.",
      body: receipt(
        tone.refundOpen,
        "Open Refund Request",
        "{{ actor.name }} requested a refund",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Amount", "{{ data.amount }}"],
          ["Purchased", "{{ data.purchased_on }}"],
          ["Reason", "{{ data.reason }}"],
        ]),
        "Review",
        "you're a Platform Admin. Every Platform Admin gets this email; the first decision wins."
      ),
    },
    "refund-approved": {
      subject: "[Cadence] Refund approved: {{ data.course_title }}",
      preheader: "{{ data.amount }} refunded.",
      body: receipt(
        tone.refundYes,
        "Refund approved",
        "Your Refund Request was approved",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Amount", "{{ data.amount }}"],
          ["Purchased", "{{ data.purchased_on }}"],
          ["Note", "{% if data.decision_note %}{{ data.decision_note }}{% else %}—{% endif %}"],
        ]),
        "View",
        "you made this Purchase and asked for a refund."
      ),
    },
    "refund-declined": {
      subject: "[Cadence] Refund declined: {{ data.course_title }}",
      preheader: "{{ data.decision_note | truncate: 80 }}",
      body: receipt(
        tone.refundNo,
        "Refund declined",
        "Your Refund Request was declined",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Amount", "{{ data.amount }}"],
          ["Purchased", "{{ data.purchased_on }}"],
          ["Note", "{{ data.decision_note }}"],
        ]) + `<p style="margin:0 0 20px;font-size:14px;color:#3f3f46">You can ask again from the course page.</p>`,
        "View course",
        "you made this Purchase and asked for a refund."
      ),
    },
    "seat-claimed": {
      subject: "[Cadence] Seat claimed: {{ data.course_title }} ({{ data.seats_left }} left)",
      preheader: "{{ actor.name }} claimed a Seat.",
      body: receipt(
        tone.team,
        "Seat claimed",
        "{{ actor.name }} claimed a Seat",
        rows([
          ["Course", "{{ data.course_title }}"],
          ["Seats", "{{ data.seats_used }} of {{ data.seats_total }} used · <b>{{ data.seats_left }} left</b>"],
        ]),
        "View team",
        "you're the Team Admin for this Team Licence."
      ),
    },
  },
};

export const VARIANTS: Variant[] = [A, B, C];

// ─── Render (what Knock would do at send time) ──────────────────────────────

export async function renderEmail(variant: Variant, fixture: Fixture) {
  const t = variant.templates[fixture.kind];
  const scope = { recipient: fixture.recipient, actor: fixture.actor, data: fixture.data, vars: VARS };
  const subject = await liquid.parseAndRender(t.subject, scope);
  const pre = await liquid.parseAndRender(t.preheader, scope);
  const content = await liquid.parseAndRender(t.body, scope);
  const html = await liquid.parseAndRender(variant.layout, { ...scope, content, preheader: pre });
  return {
    subject: decode(subject),
    preheader: decode(pre),
    html,
    source: { subject: t.subject, preheader: t.preheader, body: t.body.trim() },
  };
}

// Subjects/preheaders are plain text in the inbox; undo Liquid's HTML escape.
function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
