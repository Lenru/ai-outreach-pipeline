// Who actually decides, for every prospect with an NPI.
//
// A practice of this size has no head of marketing. The buyer is the owner, the
// president or the medical director, and NPPES names them: an organisation's
// record carries an "authorized official", the person who signed for it, with
// their title and often a DIFFERENT phone number from the practice line, which
// is usually a direct one.
//
// That is free, authoritative and already in the API prospect-find.mjs uses, so
// there is no reason to buy this from a data vendor. It is also the honest
// answer to "who do I address the email to": a named person with a stated role,
// recorded with the registry as its source, rather than "Hello".
//
// What it does NOT give: an email address. See prospect-enrich.mjs.
//
// Dry run unless --write.
//
//   node src/prospect-officials.mjs [--write] [--limit=N]

import { openStore } from "./lib/store.mjs";
import { merge } from "./lib/evidence.mjs";

const SOURCE = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=";

/** Title case a registry name, which is stored in capitals. */
const nameCase = (s) =>
  String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();

/** The decision maker on an NPPES organisation record, or null. */
export function officialOf(basic) {
  if (!basic) return null;
  const first = nameCase(basic.authorized_official_first_name);
  const last = nameCase(basic.authorized_official_last_name);
  if (!first && !last) return null;
  const cred = String(basic.authorized_official_credential || "").replace(/\.$/, "").trim();
  const name = [first, last].filter(Boolean).join(" ") + (cred ? `, ${cred}` : "");
  // "OWNER", "President", "MEDICAL DIRECTOR" all appear; normalise the shouting.
  const titleRaw = String(basic.authorized_official_title_or_position || "").trim();
  const title = /^[A-Z\s.&/-]+$/.test(titleRaw) && titleRaw.length > 3 ? nameCase(titleRaw) : titleRaw;
  return { name, title: title || null, phone: basic.authorized_official_telephone_number || null };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  // Also picks up a prospect whose official_name column is set but whose
  // evidence row is gone, which is the state a sibling script left behind when
  // it assigned the evidence column instead of merging into it. --all re-reads
  // everybody regardless.
  const needsRow = (p) =>
    !(Array.isArray(p.evidence) ? p.evidence : []).some(
      (e) => e?.by === "officials" || /^Decision maker is/.test(e?.claim || ""),
    );
  const todo = (list || [])
    .filter((p) => p.npi && (args.includes("--all") || !p.official_name || needsRow(p)))
    .slice(0, cap);
  console.log(`${todo.length} prospects needing a named decision maker, or its evidence row.\n`);

  const today = new Date().toISOString().slice(0, 10);
  let found = 0, direct = 0;
  for (const p of todo) {
    const r = await fetch(`${SOURCE}${p.npi}`, { headers: { accept: "application/json" } }).catch(() => null);
    if (!r || r.status !== 200) { console.log(`  ${p.name}: registry did not answer`); continue; }
    const o = officialOf((await r.json()).results?.[0]?.basic);
    if (!o) { console.log(`  ${p.name}: no authorized official on the record`); continue; }
    found++;

    // A number that is not the practice line is worth having on its own.
    const samePhone = String(o.phone || "").replace(/\D/g, "").slice(-10) === String(p.phone || "").replace(/\D/g, "").slice(-10);
    const directLine = o.phone && !samePhone ? o.phone : null;
    if (directLine) direct++;
    console.log(`${p.name}\n    ${o.name}${o.title ? `, ${o.title}` : ""}${directLine ? `  |  direct ${directLine}` : ""}`);

    if (!write) continue;
    const claim = `Decision maker is ${o.name}${o.title ? `, listed as ${o.title}` : ""}, the authorized official on the practice's federal registry record`
      + (directLine ? `, with ${directLine} given as their own number rather than the practice line.` : ".");
    const { error: e } = await sb.rpc("crm_save", {
      p: {
        id: p.id, official_name: o.name, official_title: o.title,
        evidence: merge(p.evidence, [{ claim, source: `${SOURCE}${p.npi}`, checked_on: today, proven: true }], "officials"),
      },
    });
    if (e) console.log(`    FAILED: ${e.message}`);
    await new Promise((x) => setTimeout(x, 120)); // a public API, used politely
  }

  console.log(`\n${found} of ${todo.length} have a named decision maker, ${direct} with a number that is not the practice line.`);
  console.log(write ? "Saved." : "dry run. pass --write to save.");
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
