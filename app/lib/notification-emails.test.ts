import { describe, it, expect } from "vitest";
import {
  emailOnlyWorkflows,
  notificationCatalogue,
} from "./notification-catalogue";
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
  const match = html.match(/<div[^>]*data-preheader[^>]*>([\s\S]*?)<\/div>/);
  return match ? textOf(match[1]) : null;
}

// The rows of the Amount / Purchased / Reason-or-Note table.
function detailRowsOf(html: string) {
  const amount = html.indexOf(">Amount<");
  if (amount === -1) return [];
  const table = html.slice(
    html.lastIndexOf("<table", amount),
    html.indexOf("</table>", amount)
  );
  return [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
      textOf(cell).replace(/&#39;/g, "'")
    )
  );
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

    expect(text).toMatch(
      /^.*Cadence RR Rae Replier replied to your question on Closures & Scope A closure captures its scope\. See makeCounter\(\)\./
    );
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
    const links = linksIn(
      (await renderEmail("discussion-reply", context)).html
    );

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

describe("Seat claimed email", () => {
  const context: EmailContext = {
    recipient: {
      id: "10",
      name: "Bossy McBossface",
      email: "bossy@example.com",
    },
    actor: { id: "5", name: "Emma Wilson", email: "emma@example.com" },
    data: {
      course_title: "Cooking & Knives",
      seats_left: "2",
      seats_total: "5",
      url: "/team",
    },
    vars,
  };

  it("uses the feed sentence in plain text as the subject", async () => {
    const email = await renderEmail("seat-claimed", context);

    expect(email.subject).toBe(
      "Emma Wilson claimed a Seat on Cooking & Knives"
    );
  });

  it("uses the Seat counts as the preheader and shows them in the body", async () => {
    const html = (await renderEmail("seat-claimed", context)).html;

    expect(preheaderOf(html)).toBe("2 of 5 Seats left.");
    expect(textOf(html)).toContain(
      "Emma Wilson claimed a Seat on Cooking & Knives 2 of 5 Seats left."
    );
  });

  it("links the feed's CTA label to the absolute /team URL", async () => {
    const links = linksIn((await renderEmail("seat-claimed", context)).html);

    expect(links).toContainEqual({
      href: "https://cadence.example/team",
      label: notificationCatalogue["seat-claimed"].ctaLabel,
    });
  });
});

describe("New Enrollment email", () => {
  const context: EmailContext = {
    recipient: { id: "2", name: "Sarah Chen", email: "sarah@example.com" },
    actor: { id: "5", name: "Emma Wilson", email: "emma@example.com" },
    data: {
      course_title: "Cooking & Knives",
      course_id: "3",
      url: "/instructor/3/students",
    },
    vars,
  };

  it("uses the feed sentence in plain text as the subject", async () => {
    const email = await renderEmail("new-enrollment", context);

    expect(email.subject).toBe("Emma Wilson enrolled in Cooking & Knives");
  });

  it("has a preheader", async () => {
    const html = (await renderEmail("new-enrollment", context)).html;

    expect(preheaderOf(html)).toBe("Cooking & Knives has a new student.");
  });

  it("links the feed's CTA label to the absolute student list URL", async () => {
    const links = linksIn((await renderEmail("new-enrollment", context)).html);

    expect(links).toContainEqual({
      href: "https://cadence.example/instructor/3/students",
      label: notificationCatalogue["new-enrollment"].ctaLabel,
    });
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

describe("Refund Request decision emails", () => {
  // The rows of the details table (the one holding "Amount").

  const decided = (decision_note: string, url: string): EmailContext => ({
    recipient: { id: "1", name: "Test User", email: "test@example.com" },
    actor: { id: "9", name: "Pat Admin", email: "pat@example.com" },
    data: {
      course_title: "Rust & You",
      amount: "$79.00",
      purchased_on: "Oct 3, 2026",
      decision_note,
      url,
    },
    vars,
  });

  describe("approved", () => {
    const context = decided("Sorry it wasn't a fit.", "/dashboard");

    it("uses the feed sentence in plain text as the subject", async () => {
      const email = await renderEmail("refund-request-approved", context);

      expect(email.subject).toBe(
        "Your Refund Request for Rust & You was approved"
      );
    });

    it("says the money is on its way in the preheader", async () => {
      const email = await renderEmail("refund-request-approved", context);

      expect(preheaderOf(email.html)).toBe("$79.00 is on its way back to you.");
    });

    it("shows the sentence and an Amount / Purchased / Note table", async () => {
      const html = (await renderEmail("refund-request-approved", context)).html;

      expect(textOf(html)).toContain(
        "Your Refund Request for Rust & You was approved"
      );
      expect(detailRowsOf(html)).toEqual([
        ["Amount", "$79.00"],
        ["Purchased", "Oct 3, 2026"],
        ["Note", "Sorry it wasn't a fit."],
      ]);
    });

    it("shows a dash when there is no note", async () => {
      const html = (
        await renderEmail("refund-request-approved", decided("", "/dashboard"))
      ).html;

      expect(detailRowsOf(html)[2]).toEqual(["Note", "—"]);
    });

    it("links the feed's CTA label to the absolute dashboard URL", async () => {
      const links = linksIn(
        (await renderEmail("refund-request-approved", context)).html
      );

      expect(links).toContainEqual({
        href: "https://cadence.example/dashboard",
        label: notificationCatalogue["refund-request-approved"].ctaLabel,
      });
    });
  });

  describe("declined", () => {
    const context = decided(
      "You finished most of the course.",
      "/courses/rust"
    );

    it("uses the feed sentence in plain text as the subject", async () => {
      const email = await renderEmail("refund-request-declined", context);

      expect(email.subject).toBe(
        "Your Refund Request for Rust & You was declined"
      );
    });

    it("uses the decision note as the preheader", async () => {
      const email = await renderEmail("refund-request-declined", context);

      expect(preheaderOf(email.html)).toBe("You finished most of the course.");
    });

    it("shows the table, then says the buyer can ask again", async () => {
      const html = (await renderEmail("refund-request-declined", context)).html;

      expect(detailRowsOf(html)).toEqual([
        ["Amount", "$79.00"],
        ["Purchased", "Oct 3, 2026"],
        ["Note", "You finished most of the course."],
      ]);
      expect(textOf(html)).toMatch(
        /Note You finished most of the course\. You can ask again from the course page\./
      );
    });

    it("sends a Team Licence buyer back to the team page to ask again", async () => {
      const html = (
        await renderEmail(
          "refund-request-declined",
          decided("Seats are in use.", "/team")
        )
      ).html;

      expect(textOf(html)).toContain("You can ask again from your team page.");
      expect(textOf(html)).not.toContain("course page");
      expect(linksIn(html)).toContainEqual({
        href: "https://cadence.example/team",
        label: notificationCatalogue["refund-request-declined"].ctaLabel,
      });
    });

    it("links the feed's CTA label to the absolute course URL", async () => {
      const links = linksIn(
        (await renderEmail("refund-request-declined", context)).html
      );

      expect(links).toContainEqual({
        href: "https://cadence.example/courses/rust",
        label: notificationCatalogue["refund-request-declined"].ctaLabel,
      });
    });

    it("escapes HTML in the course title and the note", async () => {
      const html = (
        await renderEmail("refund-request-declined", {
          ...context,
          data: {
            ...context.data,
            course_title: "<b>Rust</b>",
            decision_note: "<script>",
          },
        })
      ).html;

      expect(html).not.toContain("<b>Rust</b>");
      expect(html).not.toContain("<script>");
    });
  });
});

describe("New Open Refund Request email", () => {
  const context: EmailContext = {
    recipient: { id: "9", name: "Pat Admin", email: "pat@example.com" },
    actor: { id: "1", name: "Sam Student", email: "sam@example.com" },
    data: {
      course_title: "Rust & You",
      amount: "$79.00",
      purchased_on: "Oct 3, 2026",
      reason: "It was not what I expected.",
      url: "/admin/refunds",
    },
    vars,
  };

  it("uses the feed sentence in plain text as the subject", async () => {
    const email = await renderEmail("refund-request-opened", context);

    expect(email.subject).toBe("Sam Student requested a refund for Rust & You");
  });

  it("uses the amount and reason as the preheader", async () => {
    const email = await renderEmail("refund-request-opened", context);

    expect(preheaderOf(email.html)).toBe(
      "$79.00 · It was not what I expected."
    );
  });

  it("shows the sentence and an Amount / Purchased / Reason table", async () => {
    const html = (await renderEmail("refund-request-opened", context)).html;

    expect(textOf(html)).toContain(
      "SS Sam Student requested a refund for Rust & You"
    );
    expect(detailRowsOf(html)).toEqual([
      ["Amount", "$79.00"],
      ["Purchased", "Oct 3, 2026"],
      ["Reason", "It was not what I expected."],
    ]);
  });

  it("links the feed's CTA label to the absolute /admin/refunds URL", async () => {
    const links = linksIn(
      (await renderEmail("refund-request-opened", context)).html
    );

    expect(links).toContainEqual({
      href: "https://cadence.example/admin/refunds",
      label: notificationCatalogue["refund-request-opened"].ctaLabel,
    });
  });

  it("escapes HTML in the actor name, course title and reason", async () => {
    const html = (
      await renderEmail("refund-request-opened", {
        ...context,
        actor: { ...context.actor, name: "<i>Sam</i>" },
        data: {
          ...context.data,
          course_title: "<b>Rust</b>",
          reason: "<script>",
        },
      })
    ).html;

    expect(html).not.toContain("<i>Sam</i>");
    expect(html).not.toContain("<b>Rust</b>");
    expect(html).not.toContain("<script>");
  });
});

describe("Refund requested receipt email", () => {
  const context: EmailContext = {
    recipient: { id: "1", name: "Sam Student", email: "sam@example.com" },
    actor: {},
    data: {
      course_title: "Rust & You",
      amount: "$79.00",
      purchased_on: "Oct 3, 2026",
      reason: "It was not what I expected.",
      url: "/settings",
    },
    vars,
  };

  it("has a plain-text subject naming the course", async () => {
    const email = await renderEmail("refund-requested", context);

    expect(email.subject).toBe("Refund requested for Rust & You");
  });

  it("says it will let the buyer know, without promising another email", async () => {
    const html = (await renderEmail("refund-requested", context)).html;
    const text = textOf(html).replace(/&#39;/g, "'");

    expect(preheaderOf(html)?.replace(/&#39;/g, "'")).toBe(
      "We'll let you know when it's decided."
    );
    expect(text).toMatch(
      /Cadence We have your Refund Request for Rust & You .*We'll let you know when it's decided\./
    );
    expect(text).not.toMatch(/email you/i);
  });

  it("has a footer that doesn't offer control it can't give, still linking settings and saying replies aren't read", async () => {
    const html = (await renderEmail("refund-requested", context)).html;
    const text = textOf(html).replace(/&#39;/g, "'");

    expect(text).not.toContain("Change what Cadence emails you");
    expect(text).toContain(
      "Cadence always sends this email because you asked for a refund."
    );
    expect(linksIn(html)).toContainEqual({
      href: "https://cadence.example/settings#notifications",
      label: "Notification settings",
    });
    expect(text).toContain("This address doesn't accept replies.");
  });

  it("shows no avatar, since the buyer caused it themselves", async () => {
    const html = (await renderEmail("refund-requested", context)).html;

    expect(html).not.toContain("border-radius:20px");
  });

  it("shows an Amount / Purchased / Reason table", async () => {
    const html = (await renderEmail("refund-requested", context)).html;

    expect(detailRowsOf(html)).toEqual([
      ["Amount", "$79.00"],
      ["Purchased", "Oct 3, 2026"],
      ["Reason", "It was not what I expected."],
    ]);
  });

  it("links View refund request to the absolute URL from the data", async () => {
    for (const url of ["/settings", "/team"]) {
      const links = linksIn(
        (
          await renderEmail("refund-requested", {
            ...context,
            data: { ...context.data, url },
          })
        ).html
      );

      expect(links).toContainEqual({
        href: `https://cadence.example${url}`,
        label: emailOnlyWorkflows["refund-requested"].ctaLabel,
      });
    }
  });

  it("escapes HTML in the course title and reason", async () => {
    const html = (
      await renderEmail("refund-requested", {
        ...context,
        data: {
          ...context.data,
          course_title: "<b>Rust</b>",
          reason: "<script>",
        },
      })
    ).html;

    expect(html).not.toContain("<b>Rust</b>");
    expect(html).not.toContain("<script>");
  });
});
