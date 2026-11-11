// PROTOTYPE scratch: can a preference express "off by default, opt-in" for new-enrollment?
import Knock from "@knocklabs/node";
process.loadEnvFile(".env"); // PROTOTYPE — run from repo root: node scripts/prototype-knock/<file>.mjs
const k = new Knock({ apiKey: process.env.KNOCK_SECRET_API_KEY });
const ch = process.env.KNOCK_FEED_CHANNEL_ID;
const SARAH = "2";
const count = async () => { let n = 0; for await (const e of k.users.feeds.listItems(SARAH, ch)) if (e.source.key === "new-enrollment") n++; return n; };
const enroll = (label) => k.workflows.trigger("new-enrollment", { actor: { id: "6", name: "James Park" }, recipients: [SARAH], data: { course_id: 1, course_title: `PROTO ${label}` } });
const wait = () => new Promise(r => setTimeout(r, 4000));
const prefs = async () => JSON.stringify((({ workflows, categories, channel_types }) => ({ workflows, categories, channel_types }))(await k.users.getPreferences(SARAH, "default")));

await k.users.unsetPreferences(SARAH, "default").catch(() => {});
console.log("A no prefs:", await prefs());
let before = await count(); await enroll("A"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.setPreferences(SARAH, "default", { categories: { enrollment: false } });
console.log("B category enrollment=false:", await prefs());
before = await count(); await enroll("B"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.setPreferences(SARAH, "default", { workflows: { "new-enrollment": true } });
console.log("C then set only workflows new-enrollment=true (replace or merge?):", await prefs());
before = await count(); await enroll("C"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.setPreferences(SARAH, "default", { categories: { enrollment: false }, workflows: { "new-enrollment": true } });
console.log("D category off + workflow on:", await prefs());
before = await count(); await enroll("D"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.setPreferences(SARAH, "default", { categories: { enrollment: true } });
console.log("E category enrollment=true (opt-in):", await prefs());
before = await count(); await enroll("E"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.setPreferences(SARAH, "default", { categories: { enrollment: { channel_types: { in_app_feed: true, email: false } } } });
console.log("F category × channel (feed on, email off):", await prefs());
before = await count(); await enroll("F"); await wait(); console.log("  delivered:", (await count()) - before);

await k.users.unsetPreferences(SARAH, "default");
