// PROTOTYPE scratch: exercise the headless feed API with signed user tokens
import { signUserToken } from "@knocklabs/node";
process.loadEnvFile(".env"); // PROTOTYPE — run from repo root: node scripts/prototype-knock/<file>.mjs
const { KNOCK_PUBLIC_API_KEY: pk, KNOCK_SIGNING_KEY: sk, KNOCK_FEED_CHANNEL_ID: ch } = process.env;
const B = "https://api.knock.app/v1";
const h = async (uid) => ({ Authorization: `Bearer ${pk}`, "X-Knock-User-Token": await signUserToken(uid, { signingKey: sk }), "Content-Type": "application/json" });
const feed = async (asUid, ofUid = asUid) => {
  const r = await fetch(`${B}/users/${ofUid}/feeds/${ch}`, { headers: await h(asUid) });
  return [r.status, await r.json()];
};
const show = ([s, j]) => s !== 200 ? `HTTP ${s} ${j.type ?? ""} ${j.code ?? ""} ${j.message ?? ""}` : JSON.stringify({ meta: j.meta, items: j.entries.map(e => ({ id: e.id, wf: e.source.key, actor: e.actors?.[0]?.name, seen: !!e.seen_at, read: !!e.read_at, body: e.blocks?.[0]?.rendered?.replace(/<[^>]+>/g,"").trim() })) });
console.log("olivia(7) feed:", show(await feed("7")));
console.log("sarah(2) feed:", show(await feed("2")));
console.log("olivia token reading sarah feed:", show(await feed("7", "2")));
const [, j] = await feed("7");
const id = j.entries[0]?.id;
if (id) {
  for (const status of ["seen", "read"]) {
    const r = await fetch(`${B}/messages/batch/${status}`, { method: "POST", headers: await h("7"), body: JSON.stringify({ message_ids: [id] }) });
    console.log(`mark ${status} as olivia:`, r.status);
  }
  console.log("olivia(7) after:", show(await feed("7")));
  const r = await fetch(`${B}/messages/batch/unread`, { method: "POST", headers: await h("2"), body: JSON.stringify({ message_ids: [id] }) });
  console.log("sarah marking olivia's msg unread:", r.status, (await r.text()).slice(0, 160));
  console.log("olivia(7) after sarah attempt:", show(await feed("7")));
}
