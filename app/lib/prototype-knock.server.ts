// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?" (#49).
// Lives on branch prototype/knock-spike only. Never merge.
import Knock, { signUserToken } from "@knocklabs/node";

export const WORKFLOW_DISCUSSION_REPLY = "discussion-reply";
export const WORKFLOW_NEW_ENROLLMENT = "new-enrollment";

let envLoaded = false;
function env(name: string) {
  if (!envLoaded) {
    process.loadEnvFile(".env");
    envLoaded = true;
  }
  const value = process.env[name];
  if (!value) throw new Error(`PROTOTYPE: missing ${name} in .env`);
  return value;
}

let client: Knock | undefined;
export function knock() {
  client ??= new Knock({ apiKey: env("KNOCK_SECRET_API_KEY") });
  return client;
}

export function knockRecipientId(userId: number) {
  return String(userId);
}

export function publicConfig() {
  return {
    publicKey: env("KNOCK_PUBLIC_API_KEY"),
    channelId: env("KNOCK_FEED_CHANNEL_ID"),
  };
}

export function signFor(userId: number) {
  return signUserToken(knockRecipientId(userId), {
    signingKey: env("KNOCK_SIGNING_KEY"),
    expiresInSeconds: 60 * 60,
  });
}

export type Recipient = { id: number; name: string; email: string };

export function identify(user: Recipient) {
  return knock().users.update(knockRecipientId(user.id), {
    name: user.name,
    email: user.email,
  });
}

export function trigger(
  workflow: string,
  actor: Recipient,
  recipients: Recipient[],
  data: Record<string, unknown>
) {
  const toKnock = (u: Recipient) => ({
    id: knockRecipientId(u.id),
    name: u.name,
    email: u.email,
  });
  return knock().workflows.trigger(workflow, {
    actor: toKnock(actor),
    recipients: recipients.map(toKnock),
    data,
  });
}

export function getPreferences(userId: number) {
  return knock().users.getPreferences(knockRecipientId(userId), "default");
}

export function setWorkflowPreference(
  userId: number,
  workflow: string,
  enabled: boolean
) {
  return knock().users.setPreferences(knockRecipientId(userId), "default", {
    workflows: { [workflow]: enabled },
    // PUT replaces the whole PreferenceSet by default (verified in spike).
    __persistence_strategy__: "merge",
  } as Parameters<ReturnType<typeof knock>["users"]["setPreferences"]>[2]);
}

export function unsetPreferences(userId: number) {
  return knock().users.unsetPreferences(knockRecipientId(userId), "default");
}
