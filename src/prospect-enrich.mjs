// Give a registry lead its own website and an email, and PROVE the site is theirs.
//
// WHY THE PROOF IS THE WHOLE SCRIPT. prospect-find.mjs adds practices from the
// federal registry, which has no website field. The obvious approach, guessing
// a domain from the name, was built first and thrown away: it resolved "WHITE
// PLAINS FAMILY THERAPY PLLC" to the City of White Plains, "MH CARE YORKTOWN" to the
// town of Yorktown and "TESTING INC." to testing.com, and called each one
// proven because the page title contained words from the practice name. That is
// the same failure as the cold email that described a blog which did not exist.
//
// So: candidates come from a SEARCH for the practice, and the only accepted
// proof is that the page carries the practice's registry PHONE NUMBER. A name
// in a title is not proof, because two practices share a name and a town shares
// a name with the practice in it. Yield is lower and that is the correct trade:
// a lead with no website is a job to do, a lead with the wrong website is a
// false claim waiting to be emailed to somebody.
//
// Dry run unless --write.
//
//   node src/prospect-enrich.mjs [--write] [--limit=N]

import { openStore } from "./lib/store.mjs";
import { merge } from "./lib/evidence.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Directories, registry scrapers, review sites and marketplaces. Every one of
// these ranks above a small practice's own site for the practice's own name,
// and several print the registry phone number, so they would pass the phone
// proof while not being the practice's website at all.
export const NOT_THEIR_SITE = new RegExp(
  [
    "npiprofile", "npidb", "npir\\.org", "npino", "npi-?lookup", "npiregistry", "hipaaspace",
    "medicarelist", "ehealthscores", "guide\\.md", "doctor\\.com", "healthgrades", "vitals\\.com",
    "wellness\\.com", "ratemds", "findatopdoc", "caredash", "sharecare", "doximity", "zocdoc",
    "psychologytoday", "therapyden", "goodtherapy", "zencare", "alma\\.com", "headway\\.co",
    "yelp", "superpages", "yellowpages", "mapquest", "bbb\\.org", "manta\\.com", "dnb\\.com",
    "bizapedia", "opencorporates", "buzzfile", "chamberofcommerce", "crunchbase",
    "facebook", "instagram", "linkedin", "twitter", "x\\.com", "youtube", "tiktok", "pinterest",
    "google\\.", "bing\\.com", "duckduckgo", "wikipedia", "indeed", "glassdoor", "ziprecruiter",
    "medicaid", "medicare\\.gov", "cms\\.gov", "\\.gov$", "health\\.usnews", "usnews\\.com",
    "webmd", "everydayhealth", "psychiatry\\.org", "apa\\.org", "nami\\.org",
    "solvhealth", "mdedge", "castleconnolly", "topdoctor", "docinfo", "providermatch",
    "amazonaws", "cloudfront", "wixsite\\.com", "squarespace\\.com", "godaddysites",
  ].join("|"),
  "i",
);

// Words that say nothing about WHICH practice this is, so finding one in a
// domain proves nothing.
const GENERIC = new Set([
  "psychiatry", "psychiatric", "psychology", "psychological", "psych", "therapy", "therapist",
  "therapeutic", "counseling", "counselling", "counselor", "behavioral", "behavioural",
  "mental", "health", "healthcare", "wellness", "wellbeing", "group", "associates",
  "association", "services", "service", "center", "centre", "clinic", "practice", "partners",
  "care", "medical", "md", "do", "phd", "psyd", "lcsw", "lmhc", "pllc", "llc", "pc", "llp",
  "inc", "pa", "ltd", "the", "of", "and", "for", "new", "york", "family", "child", "children",
  "adult", "adolescent", "social", "work", "worker", "clinical", "consultants", "consulting",
  "institute", "physician", "physicians", "doctor", "nurse", "practitioner", "np", "marriage",
  "solutions", "integrative", "holistic", "comprehensive", "advanced", "complete", "total",
  // Place names: a town's own website shares them, which is how "WHITE PLAINS
  // FAMILY THERAPY PLLC" once resolved to the City of White Plains.
  "westchester", "hudson", "valley", "dutchess", "orange", "ulster", "putnam", "rockland",
  "white", "plains", "yorktown", "kingston", "newburgh", "poughkeepsie", "beacon", "carmel",
  "nyack", "rye", "brook", "mount", "kisco", "fishkill", "scarsdale", "chappaqua", "armonk",
  "bronxville", "harrison", "middletown", "goshen", "monroe", "warwick", "cornwall", "suffern",
]);

/** The words that actually identify this practice. */
export function distinctive(name) {
  return [...new Set(
    String(name).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length >= 4 && !GENERIC.has(w)),
  )];
}

/**
 * Is this host plausibly the practice's OWN domain?
 *
 * This is the signal that separates a practice from a directory, and it took
 * three attempts to find. Phone-on-the-page alone is not enough: every
 * aggregator reprints the registry phone, so local.yahoo.com and
 * ourhealthnetwork.com both "proved" they were a Yorktown psychiatrist. A page
 * title is no better, because a directory's title is the practice's name too.
 * The domain is the one thing a directory cannot fake: nobody lists a practice
 * at a domain named after it.
 *
 * The cost is false negatives, a real practice at a name unrelated to its legal
 * one. Those come back as unresolved, which is the safe direction.
 */
export function hostMatchesName(host, name) {
  const h = String(host).toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]/g, "");
  return distinctive(name).filter((w) => h.includes(w));
}

// A listing page, whatever its domain.
const DIRECTORY_MARKER =
  /(claim (this|your) (profile|listing|practice)|find a (doctor|therapist|provider)|provider directory|write a review|leave a review|compare \d+ |search results|browse (doctors|providers|therapists)|is this your (business|practice))/i;

const digits = (s) => String(s || "").replace(/\D/g, "");
const last10 = (s) => digits(s).slice(-10);

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ").trim();

async function get(url, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "user-agent": UA, accept: "text/html,*/*" } });
    return { status: r.status, url: r.url, html: r.status === 200 ? await r.text() : "" };
  } catch {
    return { status: 0, url, html: "" };
  } finally { clearTimeout(t); }
}

/** Search result URLs, directories removed, one per host. */
export function pickResults(html, limit = 6) {
  const urls = [...new Set([...String(html).matchAll(/uddg=([^&"']+)/g)].map((m) => {
    try { return decodeURIComponent(m[1]); } catch { return ""; }
  }))];
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!/^https?:\/\//.test(u)) continue;
    let host;
    try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { continue; }
    if (NOT_THEIR_SITE.test(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Domains worth trying, built FROM the practice name, best first.
 *
 * Deriving the domain is what makes this work without a search engine, and it
 * satisfies hostMatchesName by construction: we only ever visit a domain named
 * after the practice. A directory is therefore never fetched, and the phone
 * test still has to pass, which is what rejects whiteplains.com for "WHITE
 * PLAINS FAMILY THERAPY PLLC" (the city's site does not print the practice's
 * number).
 *
 * The limit is practices whose domain is not derivable from their legal name.
 * Those stay unresolved for a human to find.
 */
export function candidates(name) {
  const w = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(Boolean).filter((x) => !/^(pllc|llc|pc|llp|inc|pa|ltd)$/.test(x));
  const dist = distinctive(name);
  if (!dist.length) return []; // nothing identifying to build a domain from
  const stems = new Set();
  const all = w.join("");
  if (all.length >= 5 && all.length <= 30) stems.add(all);
  // Without the legal and courtesy words: "alexmorganpsychiatry".
  const trimmed = w.filter((x) => !/^(md|do|phd|psyd|lcsw|lmhc|np|services|service|the|of|and|at)$/.test(x)).join("");
  if (trimmed.length >= 5 && trimmed.length <= 30) stems.add(trimmed);
  const prof = w.find((x) => /^(psychiatry|psychology|psychological|counseling|therapy|wellness|psychiatric)$/.test(x));
  if (prof) stems.add((dist.join("") + prof).slice(0, 30));
  stems.add(dist.join("").slice(0, 30));
  const out = [];
  for (const st of stems) {
    if (st.length < 5) continue;
    for (const tld of [".com", ".net", ".org"]) out.push(`https://${st}${tld}`);
  }
  return out.slice(0, 12);
}

// WEB SEARCH WAS TRIED AND REMOVED. A web search for a practice returns
// directories (npiprofile, medicarelist, local.yahoo, ourhealthnetwork), and
// every one of them reprints the registry phone number, so checking the phone
// on the page "proved" a Yorktown psychiatrist lived at local.yahoo.com.
// Requiring the DOMAIN to carry the practice name as well then rejected every
// search result, including real ones, because a practice's domain often has
// nothing to do with its registered name. placesFor() below replaces the whole
// idea: Google's business listing maps the business to its website directly.
//
// Also ruled out, so none of it gets re-tried: scraped free endpoints
// rate-limit at this volume (DuckDuckGo answers 202 after a couple of hundred
// queries, Brave web 429s, Startpage returns nothing parseable, Mojeek's index
// lacks small practices); OpenStreetMap holds four mental health POIs in the
// whole of Westchester; Google Custom Search cannot search the whole web any
// more, its "Search the entire web" option being deprecated for new engines;
// Brave's Search API is paid; Apify's Google Maps actor would cost about $1.15
// for this list but the month's credit was already spent.

/**
 * Google's own business listing for this practice, via Serper's places endpoint.
 *
 * This is the thing that actually works, and it took four attempts to find.
 * Guessing a domain from the name resolved town websites; searching the web and
 * checking the phone resolved directories, which all reprint the phone. The
 * business listing is different in kind: it is Google's own mapping of a
 * business to its website, and it carries the phone number, so a registry phone
 * match makes it conclusive rather than suggestive.
 *
 * It also finds trading names no guess could reach. "DANIEL REED MD PLLC"
 * operates as Harmony Example Health at hmyhealth.example, which no permutation
 * of the registered name would ever produce.
 *
 * One credit per practice.
 */
async function placesFor(name, city) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  // No quotes here: an exact-phrase query returns no listing, while the plain
  // business name plus the town returns the business.
  const q = `${String(name).replace(/[",]/g, " ").replace(/(PLLC|LLC|P\.?C\.?|LLP|INC)/gi, " ").replace(/\s+/g, " ").trim()} ${city || ""} NY`;
  try {
    const r = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ q, gl: "us" }),
    });
    if (r.status === 403 || r.status === 429) { process.env.SEARCH_EXHAUSTED = "serper"; return []; }
    if (r.status !== 200) return [];
    return (await r.json()).places || [];
  } catch {
    return [];
  }
}

/**
 * The listing that IS this practice: same phone, and it has a website.
 *
 * Matched on the phone and never on the name, because a search for one practice
 * returns its neighbours too. The Yorktown query came back with three nearby
 * psychiatrists before the right one.
 */
export function placeByPhone(places, phone) {
  const want = last10(phone);
  if (want.length !== 10) return null;
  for (const pl of places || []) {
    if (last10(pl.phoneNumber) !== want) continue;
    if (!pl.website) continue;
    let host;
    try { host = new URL(pl.website).hostname.replace(/^www\./, ""); } catch { continue; }
    if (NOT_THEIR_SITE.test(host)) continue; // a listing can point at a directory
    return { host, url: pl.website, title: pl.title || null, address: pl.address || null };
  }
  return null;
}

// A practice inbox, not a vendor's address or an image filename.
const BAD_EMAIL = /(no-?reply|do-?not-?reply|example|sentry|wix|squarespace|godaddy|wordpress|@\dx|\.(png|jpe?g|gif|webp|svg|css|js)$|postmaster|abuse@|domain|sentry\.io)/i;

/** Emails on the page, the most inbox-looking one first. */
export function emailsFrom(html, host) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try { found.add(decodeURIComponent(m[1])); } catch { /* skip */ }
  }
  for (const m of strip(html).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) found.add(m[0]);
  const base = String(host || "").replace(/^www\./, "");
  const rank = (e) => {
    const [user, dom] = e.toLowerCase().split("@");
    let s = 0;
    if (dom === base || dom.endsWith(`.${base}`)) s += 10;
    if (/^(info|contact|office|hello|admin|reception|frontdesk|appointments|intake|scheduling)$/.test(user)) s += 5;
    if (/gmail|yahoo|aol|outlook|hotmail/.test(dom)) s += 1;
    return -s;
  };
  return [...found]
    .map((e) => e.trim().replace(/[.,;:]$/, "").toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e))
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * The registry phone number on the page. The ONLY proof accepted.
 *
 * Checked in `tel:` hrefs and in the page's digits, because a number is written
 * every imaginable way and the digits survive all of them.
 */
export function phoneProof(html, phone) {
  const want = last10(phone);
  if (want.length !== 10) return null;
  const telHit = [...html.matchAll(/tel:\+?1?([0-9\-().\s]{10,20})/gi)].some((m) => last10(m[1]) === want);
  if (telHit || digits(strip(html)).includes(want)) {
    return `the page carries the practice's registry phone number ${phone}`;
  }
  return null;
}

const PARKED = /(domain (is )?for sale|buy this domain|parked (free )?(at|by)|godaddy\.com\/forsale|future home of|coming soon|under construction|sedo\.com|afternic|hugedomains)/i;

async function resolveOne(p) {
  // 1. Google's own business listing, matched on the registry phone. Best
  //    evidence available without a human looking, and it finds trading names.
  const place = placeByPhone(await placesFor(p.name, p.city), p.phone);
  if (place) {
    const r = await get(place.url);
    const emails = r.html ? emailsFrom(r.html, place.host) : [];
    return {
      website: place.host,
      url: r.url || place.url,
      emails,
      tradingAs: place.title,
      proof: `Google's business listing for "${place.title}" at ${place.address || "that address"} gives this website and carries the practice's registry phone number ${p.phone}`,
      // A listing can name a website that no longer loads. Say so rather than
      // implying the page was read.
      unread: !r.html,
    };
  }

  // 2. Domains derived from the name, which must still pass the phone test on
  //    the page itself. Covers practices with no Google listing.
  for (const u of candidates(p.name)) {
    const r = await get(u);
    if (!r.html) continue;
    const text = strip(r.html);
    if (text.length < 120 || PARKED.test(text.slice(0, 2000))) continue;
    let host;
    try { host = new URL(r.url).hostname; } catch { continue; }
    if (NOT_THEIR_SITE.test(host)) continue;
    if (DIRECTORY_MARKER.test(text)) continue;
    const named = hostMatchesName(host, p.name);
    if (!named.length) continue;
    const proof = phoneProof(r.html, p.phone);
    if (!proof) continue;
    return {
      website: host.replace(/^www\./, ""), url: r.url, emails: emailsFrom(r.html, host),
      proof: `${proof}, and the domain carries "${named.join('", "')}" from the practice name`,
    };
  }
  return null;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
      process.stderr.write(out[k] ? "+" : ".");
    }
  }));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  const todo = (list || []).filter((p) => !p.website && !p.do_not_contact && p.phone).slice(0, cap);
  console.log(`${todo.length} leads with a phone and no website.\n`);

  // Modest concurrency: this is somebody else's search endpoint, not ours.
  const hits = await pool(todo, 4, resolveOne);
  process.stderr.write("\n");

  const today = new Date().toISOString().slice(0, 10);
  let found = 0, withEmail = 0;
  for (let k = 0; k < todo.length; k++) {
    const p = todo[k], r = hits[k];
    if (!r) continue;
    found++;
    if (r.emails.length) withEmail++;
    console.log(`${p.name}\n    ${r.website}${r.emails[0] ? `  |  ${r.emails[0]}` : "  |  no email on the page"}`);
    if (!write) continue;
    const save = {
      id: p.id, website: r.website,
      next_action: r.emails[0] ? "Run prospect-recon, then write from the evidence" : "Website found, no email on it. Find a contact.",
      evidence: merge(p.evidence, [
        { claim: `Website is ${r.website}, confirmed because ${r.proof}.`, source: r.url, checked_on: today, proven: true },
        // The ADDRESS needs its own row with its own URL, because gate 3 in
        // outreach-gates.mjs refuses to email an address whose origin is not
        // recorded on the practice's own domain. The mistakes log carries the
        // reason: an LLM lead-finder has invented plausible contact details before, and a
        // plausible wrong address is worse than a missing one.
        ...(r.emails[0]
          ? [{
              claim: `Email ${r.emails[0]} is published on the practice's own website.`,
              source: r.url, checked_on: today, proven: true,
            }]
          : []),
      ], "enrich"),
    };
    if (r.emails[0]) save.email = r.emails[0];
    const { error: e } = await sb.rpc("crm_save", { p: save });
    if (e) console.log(`    FAILED: ${e.message}`);
  }

  console.log(`\n${found} of ${todo.length} websites found and proven by phone, ${withEmail} with an email.`);
  console.log(`${todo.length - found} unresolved. Those have no website recorded, which is correct: nothing may be claimed about them.`);
  if (process.env.SEARCH_EXHAUSTED) {
    console.log("\nThe Serper quota is spent, so the rest fell back to guessed domains. Top up or wait.");
  } else if (!process.env.SERPER_API_KEY) {
    console.log("\nNo SERPER_API_KEY set, so Google's business listings were never consulted and");
    console.log("only guessed domains were tried. Most of these practices do not own a domain");
    console.log("matching their registered name, so the yield is near zero without it. serper.dev,");
    console.log("1,000 queries free, no card.");
  }
  console.log(write ? "Saved. Run prospect-recon.mjs --write next." : "dry run. pass --write to save.");
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
