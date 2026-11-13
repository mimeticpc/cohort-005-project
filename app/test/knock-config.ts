import { readdirSync, readFileSync } from "node:fs";
import { Liquid } from "liquidjs";
import type { ChannelType } from "~/lib/notification-catalogue";

// ─── Knock config in the repo (knock/) ───
// Test helpers that read the workflows, the email layout and the partials
// `npm run knock:sync` pushes, and render an email step locally the way Knock
// does at send time: pre_content and the html body are rendered in the
// layout's scope, the body fills `{{ content }}`, and `{% render %}` resolves
// knock/partials. Knock's own preview stays the final check (see README).

const knockDir = new URL("../../knock/", import.meta.url);

// The Knock channel keys the workflows send on. They must match the channel
// keys in each Knock environment (Integrations → Channels).
export const FEED_CHANNEL_KEY = "in-app-feed";
export const EMAIL_CHANNEL_KEY = "resend";
export const channelTypeOf: Record<string, ChannelType> = {
  [FEED_CHANNEL_KEY]: "in_app_feed",
  [EMAIL_CHANNEL_KEY]: "email",
};

// The one shared email layout every Notification's email step uses.
export const EMAIL_LAYOUT_KEY = "cadence";

type EmailTemplate = {
  subject: string;
  settings?: { layout_key?: string; pre_content?: string };
  "html_body@"?: string;
};

type WorkflowStep = {
  ref: string;
  type: string;
  channel_key: string;
  template: EmailTemplate & Record<string, unknown>;
};

type Workflow = { name: string; steps: WorkflowStep[] };

function readKnockFile(path: string) {
  return readFileSync(new URL(path, knockDir), "utf8");
}

export function readWorkflow(key: string): Workflow {
  return JSON.parse(readKnockFile(`workflows/${key}/workflow.json`));
}

function partialTemplates() {
  const partialsDir = new URL("partials/", knockDir);
  return Object.fromEntries(
    readdirSync(partialsDir).map((key) => {
      const partial = JSON.parse(
        readKnockFile(`partials/${key}/partial.json`)
      ) as { "content@": string };
      return [key, readKnockFile(`partials/${key}/${partial["content@"]}`)];
    })
  );
}

// Renders one partial on its own, as `{% render "<key>", ...params %}` does.
export async function renderPartial(
  key: string,
  params: Record<string, unknown>
) {
  return new Liquid().parseAndRender(partialTemplates()[key], params);
}

export type EmailContext = {
  recipient: Record<string, unknown>;
  actor: Record<string, unknown>;
  data: Record<string, unknown>;
  vars: Record<string, unknown>;
};

export type RenderedEmail = {
  subject: string;
  html: string;
};

export async function renderEmail(
  workflowKey: string,
  context: EmailContext
): Promise<RenderedEmail> {
  const step = readWorkflow(workflowKey).steps.find(
    (s) => s.channel_key === EMAIL_CHANNEL_KEY
  );
  if (!step) throw new Error(`${workflowKey} has no email step`);

  const { template } = step;
  const layoutKey = template.settings?.layout_key;
  const layout = JSON.parse(
    readKnockFile(`layouts/${layoutKey}/layout.json`)
  ) as { "html_layout@": string };
  const stepDir = `workflows/${workflowKey}/`;

  const liquid = new Liquid({ templates: partialTemplates() });
  // pre_content runs ahead of both the body and the layout, so the variables
  // it sets (preview_text) reach the layout.
  const preContent = template.settings?.pre_content ?? "";
  const htmlBody = template["html_body@"]
    ? readKnockFile(stepDir + template["html_body@"])
    : "";

  const content = await liquid.parseAndRender(preContent + htmlBody, context);
  const html = await liquid.parseAndRender(
    preContent + readKnockFile(`layouts/${layoutKey}/${layout["html_layout@"]}`),
    { ...context, content }
  );

  return {
    subject: await liquid.parseAndRender(template.subject, context),
    html,
  };
}
