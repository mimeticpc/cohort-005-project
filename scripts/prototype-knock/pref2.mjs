import Knock from "@knocklabs/node";
process.loadEnvFile(".env"); // PROTOTYPE — run from repo root: node scripts/prototype-knock/<file>.mjs
const k = new Knock({ apiKey: process.env.KNOCK_SECRET_API_KEY });
const ch = process.env.KNOCK_FEED_CHANNEL_ID;
let i = 0;
for await (const e of k.users.feeds.listItems("2", ch)) { if (i++ < 3) console.log(e.data?.course_title, JSON.stringify(e.source)); }
await k.users.setPreferences("2", "default", { workflows: { "new-enrollment": false } });
let before = 0; for await (const e of k.users.feeds.listItems("2", ch)) before++;
await k.workflows.trigger("new-enrollment", { actor: { id: "6", name: "James Park" }, recipients: ["2"], data: { course_id: 1, course_title: "PROTO G workflow=false" } });
await new Promise(r => setTimeout(r, 5000));
let after = 0; for await (const e of k.users.feeds.listItems("2", ch)) after++;
console.log("G workflow new-enrollment=false delivered:", after - before);
await k.users.unsetPreferences("2", "default");
