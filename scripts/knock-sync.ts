// npm run knock:sync [environment]
//
// Pushes the Notification config in the repo to a Knock environment (ADR 0013):
//   1. `knock push --commit` for everything in knock/ (Development): the
//      email partials and layout first, then the workflows that use them.
//      For any other environment, the Development commits are then promoted
//      to it with `knock commit promote` — Knock only accepts changes in
//      Development.
//   2. PUT /v1/environments/{slug}/defaults with the default Notification
//      Preferences generated from app/lib/notification-catalogue.ts. The PUT
//      replaces the whole set, so every catalogue entry is sent every time.
//
// Needs KNOCK_SERVICE_TOKEN (from the environment or .env). Run by hand for
// Development; a required deploy step for Production.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { environmentDefaults } from "../app/lib/notification-catalogue";

// Pinned: the project only adopts releases at least 14 days old.
const KNOCK_CLI = "@knocklabs/cli@1.5.0";
const CONTROL_API = "https://control.knock.app/v1";
const DEVELOPMENT = "development";

if (existsSync(".env")) process.loadEnvFile(".env");

const serviceToken = process.env.KNOCK_SERVICE_TOKEN;
if (!serviceToken) {
  console.error(
    "KNOCK_SERVICE_TOKEN is not set. Create a service token in the Knock dashboard and add it to .env."
  );
  process.exit(1);
}

const environment = process.argv[2] ?? DEVELOPMENT;

function knock(...args: string[]) {
  console.log(`$ knock ${args.join(" ")}`);
  execFileSync("npx", ["--yes", KNOCK_CLI, ...args], {
    stdio: "inherit",
    env: { ...process.env, KNOCK_SERVICE_TOKEN: serviceToken },
  });
}

knock(
  "push",
  "--knock-dir",
  "knock",
  "--commit",
  "--commit-message",
  "knock:sync",
  "--environment",
  DEVELOPMENT
);

if (environment !== DEVELOPMENT) {
  knock("commit", "promote", "--to", environment, "--force");
}

const preferenceSet = environmentDefaults();
console.log(
  `PUT ${CONTROL_API}/environments/${environment}/defaults\n${JSON.stringify(preferenceSet, null, 2)}`
);
const response = await fetch(
  `${CONTROL_API}/environments/${encodeURIComponent(environment)}/defaults`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ preference_set: preferenceSet }),
  }
);
if (!response.ok) {
  console.error(
    `Setting environment defaults failed: ${response.status} ${await response.text()}`
  );
  process.exit(1);
}

console.log(`knock:sync done for ${environment}.`);
