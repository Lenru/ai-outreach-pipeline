// Find Hudson Valley mental health practices worth emailing.
//
// WHY. The CRM had 15 prospects and 10 are now contacted, so the pipeline runs
// dry in a week. A "165-practice list" was referred to and never found, and
// Noah does not know where it went, so this rebuilds one from a source that
// cannot be lost: NPPES, the federal provider registry, which is public, free
// and authoritative about who is actually practising where.
//
// What it gives: practice name, location, phone, NPI, taxonomy. What it does
// NOT give: a website or an email. So this fills the top of the funnel and
// `prospect-recon.mjs` does the rest once a website is known. A row written
// here carries NO claims about the practice, only registry facts, which is the
// whole point: see src/lib/evidence.mjs.
//
// Dry run unless --write.
//
//   node src/prospect-find.mjs [--write] [--limit=N]

import { openStore } from "./lib/store.mjs";

// Where Noah can credibly say "close to home".
export const TOWNS = [
  // Westchester
  "White Plains", "Scarsdale", "Rye", "Rye Brook", "Mount Kisco", "Bedford", "Chappaqua",
  "Armonk", "Katonah", "Harrison", "Mamaroneck", "Larchmont", "Bronxville", "Tarrytown",
  "Hartsdale", "Yorktown Heights", "Somers", "Briarcliff Manor", "Pleasantville",
  // Putnam
  "Carmel", "Brewster", "Mahopac", "Cold Spring",
  // Dutchess
  "Poughkeepsie", "Fishkill", "Beacon", "Wappingers Falls", "Rhinebeck", "Hyde Park",
  "Pawling", "Millbrook", "Red Hook",
  // Orange
  "Newburgh", "Middletown", "Goshen", "Monroe", "New Windsor", "Warwick", "Cornwall",
  // Ulster
  "Kingston", "New Paltz", "Saugerties", "Woodstock", "Highland",
  // Rockland
  "Nyack", "Suffern", "New City", "Pearl River", "Nanuet",
];

// Behavioral health only. Each is matched as a prefix by the API.
const TAXONOMIES = [
  "Psychiatry",
  "Clinic/Center, Mental Health",
  "Psychologist",
  "Social Worker, Clinical",
  "Counselor, Mental Health",
  "Nurse Practitioner, Psychiatric/Mental Health",
  "Marriage & Family Therapist",
];

// Not the buyer. A hospital, a county agency or a charity does not hire a
// one-person social media studio, and a neurology group that happens to carry
// the "Psychiatry & Neurology" board code is not a psychiatry practice.
export const NOT_A_PROSPECT =
  /\b(HOSPITAL|MEDICAL CENTER|HEALTH SYSTEM|HEALTHCARE SYSTEM|UNIVERSITY|COLLEGE|SCHOOL DISTRICT|COUNTY OF|CITY OF|STATE OF|DEPARTMENT|NURSING HOME|REHABILITATION CENTER|ASSISTED LIVING|PHARMACY|LABORATORY|URGENT CARE|HOSPICE|HOME CARE|NEUROLOG|ONCOLOGY|CARDIOLOGY|ORTHOPED|PEDIATRIC MEDICAL|FEDERALLY QUALIFIED|COMMUNITY ACTION|SALVATION ARMY|CATHOLIC CHARITIES|YMCA|BOARD OF|HEALTH QUEST|HEALTHQUEST|NUVANCE|WESTMED|CARE MOUNT|CAREMOUNT|OPTUM|MONTEFIORE|NORTHWELL|ST VINCENT|SAINT VINCENT|ST\.? ?JOSEPH|BON SECOURS|VASSAR BROTHERS|PRESBYTERIAN|MOUNT SINAI|WEILL CORNELL|COLUMBIA DOCTORS|NYU|LANGONE|GOOD SAMARITAN|LIFESTANCE|THRIVEWORKS|MINDPATH|MENTAL HEALTH ASSOCIATION)\b/i;

const IS_MENTAL_HEALTH = /psychiatr|psycholog|mental health|social worker|counselor|behavioral|marriage|addiction|substance/i;

// NPPES writes a taxonomy as "Board, Specialisation". The board "Psychiatry &
// Neurology" covers both professions, so a neurology group carries the word
// "Psychiatry" and sails through a naive match. The SPECIALISATION is what says
// which one they actually are.
const specOf = (desc) => String(desc).split(",").pop().trim();

const TOWN_SET = new Set(TOWNS.map((t) => t.toLowerCase()));

// "BRIAN COLE MD" and "Brian Cole MD & Associates" are one practice, and
// "HEALTH QUEST MEDICAL PRACTICE" and "... PRACTICE, PC" are one group. Legal
// suffixes and punctuation carry no meaning here, so they come off before any
// comparison.
const norm = (n) =>
  String(n).toLowerCase()
    .replace(/(p\.?c\.?|pllc|llc|llp|inc|pa|ltd|md|do|phd|psyd|lcsw|and associates|& associates)/g, " ")
    .replace(/[^a-z0-9]/g, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(city, taxonomy) {
  const u = new URL("https://npiregistry.cms.hhs.gov/api/");
  u.searchParams.set("version", "2.1");
  u.searchParams.set("enumeration_type", "NPI-2"); // organisations, not individuals
  u.searchParams.set("state", "NY");
  u.searchParams.set("city", city);
  u.searchParams.set("taxonomy_description", taxonomy);
  u.searchParams.set("limit", "200");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (r.status === 200) return (await r.json()).results || [];
      if (r.status !== 429 && r.status < 500) return [];
    } catch { /* retry */ }
    await sleep(1000 * (attempt + 1));
  }
  return [];
}

/** A registry record reduced to the fields a prospect row needs. */
export function shape(rec) {
  const name = rec.basic?.organization_name?.trim();
  if (!name) return null;
  const taxes = (rec.taxonomies || []).map((t) => t.desc).filter(Boolean);
  const loc = (rec.addresses || []).find((a) => a.address_purpose === "LOCATION") || {};
  // Must actually be a behavioral health practice, and must not be an institution.
  if (NOT_A_PROSPECT.test(name)) return null;
  const specs = taxes.map(specOf);
  if (!specs.some((t) => IS_MENTAL_HEALTH.test(t))) return null;
  const primary = (rec.taxonomies || []).find((t) => t.primary) || (rec.taxonomies || [])[0];
  return {
    name: name.replace(/\s+/g, " "),
    npi: String(rec.number),
    specialty: primary?.desc || null,
    city: (loc.city || "").replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) || null,
    state: loc.state || "NY",
    address: [loc.address_1, loc.address_2].filter(Boolean).join(", ") || null,
    phone: loc.telephone_number || null,
    taxonomies: taxes,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: have, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  // NPI is unique on the prospects table, and a name can be spelled two ways, so both
  // are checked: an insert that trips the unique index would abort the run.
  const haveNpi = new Set((have || []).map((p) => p.npi).filter(Boolean));
  const haveName = [...new Set((have || []).map((p) => norm(p.name)).filter(Boolean))];
  // A PREFIX test, not containment. The registry name is often the shorter form
  // of one we hold ("BRIAN COLE MD" for "Brian Cole MD & Associates"), so
  // equality is too strict. But plain containment suppressed a real new lead:
  // "ST VINCENT WESTCHESTER PSYCHIATRY" contains "westchesterpsychiatry" and is
  // a different organisation entirely. A shared prefix of some length is the
  // honest middle.
  const known = (n) => {
    const x = norm(n);
    if (x.length < 10) return haveName.includes(x);
    return haveName.some((h) => h === x || (h.length >= 10 && (h.startsWith(x) || x.startsWith(h))));
  };

  const found = new Map();
  const matched = new Map(); // already in the CRM: their NPI is worth keeping
  const seenIn = new Map(); // name -> towns it appears in
  let calls = 0;
  for (const city of TOWNS) {
    for (const tax of TAXONOMIES) {
      const recs = await query(city, tax);
      calls++;
      for (const rec of recs) {
        const s = shape(rec);
        if (!s) continue;
        // The registry's city search is loose and returns neighbouring places,
        // including other states. Only keep a practice whose own LOCATION
        // address is in a town on the list.
        if (!s.city || !TOWN_SET.has(s.city.toLowerCase()) || s.state !== "NY") continue;
        seenIn.set(norm(s.name), (seenIn.get(norm(s.name)) || new Set()).add(s.city));
        if (haveNpi.has(s.npi)) continue;
        if (known(s.name)) { matched.set(s.npi, s); continue; }
        if (!found.has(s.npi)) found.set(s.npi, s);
      }
      await sleep(120);
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  // One name with its own NPI in three or more towns is a health system with
  // branches, not a private practice. Health Quest / Nuvance is why this is here.
  const chains = new Set([...seenIn].filter(([, towns]) => towns.size >= 3).map(([n]) => n));
  for (const [npi, s] of found) if (chains.has(norm(s.name))) found.delete(npi);
  if (chains.size) console.log(`dropped ${chains.size} multi-site groups: ${[...chains].join(", ")}\n`);

  if (matched.size) {
    console.log("already in the CRM, and the registry fills in their NPI:");
    for (const m of matched.values()) console.log(`  ${m.name}  NPI ${m.npi}  (${m.city})`);
    console.log("");
  }

  const list = [...found.values()].sort((a, b) => a.city?.localeCompare(b.city) || a.name.localeCompare(b.name)).slice(0, cap);
  console.log(`${calls} registry queries, ${found.size} new practices, showing ${list.length}\n`);
  for (const s of list) {
    console.log(`${s.name}\n    ${s.city}, ${s.state}  |  ${s.phone || "no phone"}  |  NPI ${s.npi}\n    ${s.specialty}`);
  }

  if (!write) {
    console.log(`\ndry run. pass --write to add ${list.length} as leads.`);
    return;
  }
  let added = 0;
  for (const s of list) {
    const { error: e } = await sb.rpc("crm_save", {
      p: {
        brand: "watsons-media", name: s.name, stage: "lead", npi: s.npi,
        specialty: s.specialty, city: s.city, state: s.state, address: s.address, phone: s.phone,
        source: "NPPES federal provider registry, 2026-10-15",
        next_action: "Find the website, then run prospect-recon before writing anything",
        notes: `Taxonomies on the registry: ${s.taxonomies.join("; ")}. No website or email yet, and nothing is known about this practice beyond the registry.`,
      },
    });
    if (e) console.log(`  FAILED ${s.name}: ${e.message}`);
    else added++;
  }
  console.log(`\n${added} added as leads. None has a website yet: that is the next step.`);
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
