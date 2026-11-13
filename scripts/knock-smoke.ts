// npm run knock:smoke
//
// Manual end-to-end check against real Knock (never part of `npm run test`).
// Sends all seven catalogue Notifications and the "Refund requested" receipt
// to your own Knock user, straight through the KnockGateway with fixed sample
// data (scripts/knock-smoke-messages.ts): no database, no trigger functions.
// Then signs a user token and reads your feed with it, the way the browser
// does, to check the feed rows arrived.
//
// Needs the KNOCK_* keys (see README) and:
//   KNOCK_SMOKE_USER_ID     your Knock user id. Use your DevUI user's Cadence
//                           id (e.g. "1") to see the rows in the app's bell.
//   KNOCK_SMOKE_USER_EMAIL  where the emails go (Development's To override
//                           still applies).
//   KNOCK_SMOKE_USER_NAME   optional, defaults to "Smoke Tester".
//
// Side effects on that user: the trigger re-identifies them with the name and
// email above, and every Notification's channels are switched on in their
// Notification Preferences so default-off ones arrive too. Reset them on
// /settings afterwards if you want your defaults back.
//
// Run `npm run knock:sync` first so Knock has the current workflows.

import { knockGateway, readKnockEnv } from "../app/lib/knock-gateway.server";
import {
  emailOnlyWorkflows,
  notificationCatalogue,
} from "../app/lib/notification-catalogue";
import { sendSmokeMessages } from "./knock-smoke-messages";

const KNOCK_API = "https://api.knock.app/v1";
const FEED_WAIT_MS = 30_000;
const FEED_POLL_MS = 2_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const env = readKnockEnv(); // loads .env
if (!env) {
  fail(
    "KNOCK_SECRET_API_KEY, KNOCK_PUBLIC_API_KEY, KNOCK_SIGNING_KEY and KNOCK_FEED_CHANNEL_ID must be set (in .env)."
  );
}
const {
  KNOCK_SMOKE_USER_ID: userId,
  KNOCK_SMOKE_USER_EMAIL: email,
  KNOCK_SMOKE_USER_NAME: name = "Smoke Tester",
} = process.env;
if (!userId || !email) {
  fail(
    "KNOCK_SMOKE_USER_ID and KNOCK_SMOKE_USER_EMAIL must be set (in .env): your Knock user id and your inbox."
  );
}

const gateway = knockGateway(env);
const startedAt = new Date();
const runId = `smoke:${startedAt.getTime()}`;

console.log(`Sending smoke messages to user ${userId} <${email}> (${runId})`);
const sent = await sendSmokeMessages(
  gateway,
  { id: userId, name, email },
  runId
);
for (const key of sent) console.log(`  triggered ${key}`);

// ─── Feed check with a signed user token ───
// Only Notifications have a feed step; the receipt is email-only.
type FeedEntry = { source: { key: string }; inserted_at: string };

const token = await gateway.signUserToken(userId);
const expected = new Set<string>(Object.keys(notificationCatalogue));

async function fetchFeedKeys(): Promise<Set<string>> {
  const response = await fetch(
    `${KNOCK_API}/users/${encodeURIComponent(userId!)}/feeds/${encodeURIComponent(env!.feedChannelId)}?page_size=50`,
    {
      headers: {
        Authorization: `Bearer ${env!.publicApiKey}`,
        "X-Knock-User-Token": token,
      },
    }
  );
  if (!response.ok) {
    fail(
      `Feed read with the signed user token failed: ${response.status} ${await response.text()}`
    );
  }
  const { entries } = (await response.json()) as { entries: FeedEntry[] };
  return new Set(
    entries
      .filter((entry) => new Date(entry.inserted_at) >= startedAt)
      .map((entry) => entry.source.key)
  );
}

const deadline = Date.now() + FEED_WAIT_MS;
let arrived = new Set<string>();
while (Date.now() < deadline) {
  arrived = await fetchFeedKeys();
  if ([...expected].every((key) => arrived.has(key))) break;
  await new Promise((resolve) => setTimeout(resolve, FEED_POLL_MS));
}

const missing = [...expected].filter((key) => !arrived.has(key));
if (missing.length > 0) {
  fail(
    `Signed token read the feed, but these rows didn't arrive within ${FEED_WAIT_MS / 1000}s: ${missing.join(", ")}. Check Knock's message logs.`
  );
}

const emailCount =
  Object.values(notificationCatalogue).filter(
    (entry) => "email" in entry.defaults
  ).length + Object.keys(emailOnlyWorkflows).length;

console.log(
  `Feed: all ${expected.size} Notification rows arrived (read with a signed user token).
Now check by hand:
  - ${email}: ${emailCount} emails (including the "Refund requested" receipt)
  - the bell in the app, logged in as user ${userId}
  - each template in Knock's preview`
);
