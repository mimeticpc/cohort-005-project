import { describe, it, expect } from "vitest";
import { notificationCatalogue } from "./notification-catalogue";
import {
  renderEmail,
  renderPartial,
  type EmailContext,
} from "~/test/knock-config";

// Renders the email steps in knock/ the way Knock does, with the trigger
// `data` notifications.server.ts sends and the environment's `vars`.

const vars = {
  app_url: "https://cadence.example",
  settings_url: "https://cadence.example/settings#notifications",
};

function linksIn(html: string) {
  return [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href, label]) => ({ href, label: label.replace(/\s+/g, " ").trim() })
  );
}

function textOf(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function preheaderOf(html: string) {
  const match = html.match(
    /<div[^>]*data-preheader[^>]*>([\s\S]*?)<\/div>/
  );
  return match ? textOf(match[1]) : null;
}

describe("Discussion Reply email", () => {
  const context: EmailContext = {
    recipient: { id: "1", name: "Test User", email: "test@example.com" },
    actor: { id: "2", name: "Rae Replier", email: "rae@example.com" },
    data: {
      course_title: "TypeScript Basics",
      lesson_title: "Closures & Scope",
      excerpt: "A closure captures its scope. See makeCounter().",
      url: "/courses/typescript-basics/lessons/3#discussion",
    },
    vars,
  };

  it("uses the feed sentence in plain text as the subject", async () => {
    const email = await renderEmail("discussion-reply", context);

    expect(email.subject).toBe(
      "Rae Replier replied to your question on Closures & Scope"
    );
  });

  it("uses the excerpt as the preheader", async () => {
    const email = await renderEmail("discussion-reply", context);

    expect(preheaderOf(email.html)).toBe(
      "A closure captures its scope. See makeCounter()."
    );
  });

  it("shows the wordmark, the actor's initials, the sentence and the excerpt", async () => {
    const text = textOf((await renderEmail("discussion-reply", context)).html);

    expect(text).toMatch(/^.*Cadence RR Rae Replier replied to your question on Closures & Scope A closure captures its scope\. See makeCounter\(\)\./);
  });

  it("uses one initial for a one-word name and two for a longer one", async () => {
    const initialsFor = async (name: string) =>
      textOf(
        (
          await renderEmail("discussion-reply", {
            ...context,
            actor: { ...context.actor, name },
          })
        ).html
      ).match(/Cadence (\S+) /)?.[1];

    expect(await initialsFor("cher")).toBe("C");
    expect(await initialsFor("Ada King Lovelace")).toBe("AL");
  });

  it("links the feed's CTA label to the absolute discussion URL", async () => {
    const links = linksIn((await renderEmail("discussion-reply", context)).html);

    expect(links).toContainEqual({
      href: "https://cadence.example/courses/typescript-basics/lessons/3#discussion",
      label: notificationCatalogue["discussion-reply"].ctaLabel,
    });
  });

  it("links the footer to the Notification settings and says replies aren't read", async () => {
    const html = (await renderEmail("discussion-reply", context)).html;

    expect(linksIn(html)).toContainEqual({
      href: "https://cadence.example/settings#notifications",
      label: "Notification settings",
    });
    expect(textOf(html)).toContain("This address doesn't accept replies.");
  });

  it("escapes HTML in the names and the excerpt", async () => {
    const html = (
      await renderEmail("discussion-reply", {
        ...context,
        actor: { ...context.actor, name: "<b>Eve</b>" },
        data: { ...context.data, excerpt: "Use <script> tags" },
      })
    ).html;

    expect(html).not.toContain("<b>Eve</b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("New Discussion Question email", () => {
  const context: EmailContext = {
    recipient: { id: "2", name: "Test Instructor", email: "i@example.com" },
    actor: { id: "1", name: "Sam Student", email: "sam@example.com" },
    data: {
      course_title: "TypeScript Basics",
      lesson_title: "Closures & Scope",
      excerpt: "Why does this print undefined?",
      url: "/instructor/questions",
    },
    vars,
  };

  it("uses the feed sentence in plain text as the subject", async () => {
    const email = await renderEmail("discussion-question", context);

    expect(email.subject).toBe(
      "Sam Student asked a question on Closures & Scope"
    );
  });

  it("uses the excerpt as the preheader", async () => {
    const email = await renderEmail("discussion-question", context);

    expect(preheaderOf(email.html)).toBe("Why does this print undefined?");
  });

  it("shows the sentence and the excerpt", async () => {
    const text = textOf(
      (await renderEmail("discussion-question", context)).html
    );

    expect(text).toContain(
      "Sam Student asked a question on Closures & Scope Why does this print undefined?"
    );
  });

  it("links the Answer CTA to the absolute /instructor/questions URL", async () => {
    const links = linksIn(
      (await renderEmail("discussion-question", context)).html
    );

    expect(links).toContainEqual({
      href: "https://cadence.example/instructor/questions",
      label: notificationCatalogue["discussion-question"].ctaLabel,
    });
    expect(notificationCatalogue["discussion-question"].ctaLabel).toBe(
      "Answer"
    );
  });

  it("escapes HTML in the names and the excerpt", async () => {
    const html = (
      await renderEmail("discussion-question", {
        ...context,
        actor: { ...context.actor, name: "<b>Eve</b>" },
        data: {
          ...context.data,
          lesson_title: "<i>L</i>",
          excerpt: "Use <script> tags",
        },
      })
    ).html;

    expect(html).not.toContain("<b>Eve</b>");
    expect(html).not.toContain("<i>L</i>");
    expect(html).not.toContain("<script>");
  });
});

// The refund emails (#64, #65) use this table in place of the excerpt.
describe("cadence-details partial", () => {
  function rowsOf(html: string) {
    return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
      [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
        textOf(cell)
      )
    );
  }

  const purchase = { amount: "$59.99", purchased_on: "Nov 2, 2026" };

  it("shows Amount, Purchased and the labelled note", async () => {
    const html = await renderPartial("cadence-details", {
      ...purchase,
      note_label: "Reason",
      note: "Too advanced for me",
    });

    expect(rowsOf(html)).toEqual([
      ["Amount", "$59.99"],
      ["Purchased", "Nov 2, 2026"],
      ["Reason", "Too advanced for me"],
    ]);
  });

  it("shows a dash when there is no note", async () => {
    const html = await renderPartial("cadence-details", {
      ...purchase,
      note_label: "Note",
      note: "",
    });

    expect(rowsOf(html)[2]).toEqual(["Note", "—"]);
  });

  it("escapes HTML in the note", async () => {
    const html = await renderPartial("cadence-details", {
      ...purchase,
      note_label: "Note",
      note: "<img src=x>",
    });

    expect(html).not.toContain("<img");
  });
});
