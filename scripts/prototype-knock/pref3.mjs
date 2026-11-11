// PROTOTYPE scratch: check 4 rerun with env defaults + categories
import Knock from "@knocklabs/node";
process.loadEnvFile(".env"); // PROTOTYPE — run from repo root: node scripts/prototype-knock/<file>.mjs
const k = new Knock({ apiKey: process.env.KNOCK_SECRET_API_KEY });
const ch = process.env.KNOCK_FEED_CHANNEL_ID;
const SARAH = "2";
const count = async () => { let n = 0; for await (const e of k.users.feeds.listItems(SARAH, ch)) if (e.source.key === "new-enrollment") n++; return n; };
const run = async (label) => { const b = await count(); await k.workflows.trigger("new-enrollment", { actor: { id: "6", name: "James Park" }, recipients: [SARAH], data: { course_id: 1, course_title: `PROTO ${label}` } }); await new Promise(r => setTimeout(r, 5000)); return (await count()) - b; };
const prefs = async () => { const p = await k.users.getPreferences(SARAH, "default"); return JSON.stringify({ workflows: p.workflows, categories: p.categories }); };
const set = (p) => k.users.setPreferences(SARAH, "default", { ...p, __persistence_strategy__: "merge" });

await k.users.unsetPreferences(SARAH, "default").catch(() => {});
console.log("1 no user prefs (env default only):", await prefs(), "→ delivered", await run("1"));
await set({ workflows: { "new-enrollment": true } });
console.log("2 opt in (workflow=true, merge):", await prefs(), "→ delivered", await run("2"));
await set({ categories: { enrollment: { channel_types: { in_app_feed: true, email: false } } } });
console.log("3 + category×channel feed on/email off (merge):", await prefs(), "→ delivered", await run("3"));
await set({ workflows: { "new-enrollment": false } });
console.log("4 opt back out:", await prefs(), "→ delivered", await run("4"));
await k.users.unsetPreferences(SARAH, "default");
for await (const e of k.users.feeds.listItems(SARAH, ch)) { console.log("latest item source:", JSON.stringify(e.source.categories)); break; }
