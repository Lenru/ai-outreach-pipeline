// Find the contact address on a prospect's OWN website, and record the page it was on.
//
// 30 of the 61 practices that have a website have no email at all, so they
// cannot be contacted: gate 3 in outreach-gates.mjs refuses to send to an
// address unless a proven evidence row names the page it was read from.
// prospect-verify-email.mjs proves an address we already hold. This finds one
// we do not.
//
// NO MODEL IS INVOLVED, DELIBERATELY. The mistakes log: "an LLM lead-finder invents contact
// details for lead enrichment." On 2026-10-16 its daily run returned a
// university counselling service and a chain as independent practices, and gave
// a contact page URL instead of an address for 7 of 10. We already know each
// practice's website here, so finding the address is a fetch and a regex, and a
// regex cannot invent one.
//
// THE DOMAIN RULE IS THE WHOLE SCRIPT. An address printed on a practice's page
// is not necessarily the practice's. These pages carry their web designer's
// address, their billing company's, their landlord's, their parent charity's.
// So an address is only written to the CRM when its domain matches the
// website's. Anything else is reported for a human and left out. drquinn.example
// is the live example: an address at that domain was recorded from
// uptownpsychologist.com, and gate 3 has held that practice ever since, because
// nobody can say which of the two sites is theirs.
//
// Dry run unless --write.
//
//   node src/prospect-find-email.mjs [--write] [--limit=N]

import { openStore } from "./lib/store.mjs";
import { merge } from "./lib/evidence.mjs";
import { get, pagesFor, strip } from "./prospect-verify-email.mjs";

const EMAIL = /[a-z0-9][a-z0-9._%+'-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi;

// "logo@2x.png" and "hero@3x.webp" match an email shape. They are filenames.
const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|css|js|mjs|json|woff2?|ttf|eot|otf|ico|pdf|mp4|webm|zip)$/i;

// Nobody reads these, so sending to one is the same as not sending.
const UNATTENDED = /^(no-?reply|do-?not-?reply|donotreply|postmaster|mailer-daemon|bounce|abuse|hostmaster|root|null|void|sentry|example|test|your-?email|email|username)$/i;

// Platform and tooling domains that appear in page source without ever being
// anybody's inbox.
const NOT_AN_INBOX = /(squarespace|wixpress|wix\.com|godaddy|wordpress\.(com|org)|shopify|sentry\.io|ingest\.sentry|example\.(com|org|net)|yourdomain|your-?site|domain\.(com|tld)|localhost|sentry-cdn|cloudflare|w3\.org|schema\.org|googleapis)/i;

// A free mailbox is a real address and often genuinely the practice's, but its
// domain can never PROVE that, so it is reported rather than saved.
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|aol|hotmail|outlook|live|msn|icloud|me|mac|proton|protonmail|pm|comcast|verizon|optonline|optimum|att|sbcglobal|earthlink|bellsouth|roadrunner|twc|charter|spectrum|cox|juno|mail|gmx|zoho|yandex|hushmail|fastmail)\./i;

// What a practice calls its front desk. Worth more than a clinician's personal
// address: it is read by whoever handles enquiries.
const FRONT_DESK = /^(info|information|contact|contactus|office|admin|hello|hi|reception|receptionist|frontdesk|front_?desk|appointments?|scheduling|schedule|intake|inquir(y|ies)|enquir(y|ies)|help|support|team|staff|practice|clinic|care|mail|general)$/i;

// Real inboxes that are the wrong door for this particular email.
const WRONG_DOOR = /^(billing|invoices?|accounts?|accounting|payments?|insurance|careers?|jobs|employment|hr|recruiting|recruitment|media|press|privacy|legal|compliance|webmaster|web|marketing|sales|it|tech|unsubscribe|fax|referrals?|records|medicalrecords)$/i;

/**
 * Cloudflare's email obfuscation, undone.
 *
 * Cloudflare replaces a mailto on a page with a hex blob, which is the address
 * XORed byte by byte against its own first byte. Without this, every site
 * behind that feature reads as "publishes no email", which is a wrong answer
 * rather than a missing one. Six lines for the whole class of site.
 */
export function deCf(hex) {
  const bytes = String(hex || "").match(/../g)?.map((h) => parseInt(h, 16)) || [];
  if (bytes.length < 2 || !Number.isFinite(bytes[0])) return "";
  const key = bytes[0];
  return bytes.slice(1).map((b) => String.fromCharCode(b ^ key)).join("");
}

/** The registrable domain, so mail.example.com and example.com compare equal. */
export function registrable(host) {
  const parts = String(host || "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "")
    .split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  // ponytail: last two labels, plus the two-part TLDs we might plausibly meet.
  // A real public-suffix list is the upgrade if we prospect outside the US.
  const twoPart = ["co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "co.za", "com.br"];
  const tail = parts.slice(-2).join(".");
  return twoPart.includes(tail) ? parts.slice(-3).join(".") : tail;
}

export const domainOf = (email) => String(email || "").split("@")[1] || "";
export const localOf = (email) => String(email || "").split("@")[0] || "";

/** Is this address at the same domain as the website we proved is theirs? */
export function sameDomain(email, website) {
  const a = registrable(domainOf(email));
  const b = registrable(website);
  return Boolean(a && b && a === b);
}

/** One address, normalised, or null if it is not an address we would ever use. */
export function clean(raw) {
  const e = String(raw || "").trim().toLowerCase()
    .replace(/^mailto:/, "").replace(/[?#].*$/, "")
    .replace(/^[<("'\s]+/, "").replace(/[>)"'.,;:\s]+$/, "");
  if (!/^[a-z0-9][a-z0-9._%+'-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}$/.test(e)) return null;
  if (ASSET.test(e)) return null;
  if (UNATTENDED.test(localOf(e))) return null;
  if (NOT_AN_INBOX.test(domainOf(e))) return null;
  return e;
}

/**
 * Every address on one page, each tagged with how it was written there.
 *
 * A mailto href is the strongest signal, because somebody linked it on purpose.
 * Free text is weakest: it catches an address in a privacy policy as readily as
 * one on a contact page. The raw HTML is read only for mailto and for
 * Cloudflare's blob; everything else comes from the stripped text, so a CSS
 * `@media` rule or a Sentry key in a script tag cannot be read as an inbox.
 */
export function emailsOn(html, pageUrl) {
  const found = new Map();
  const add = (raw, how) => {
    const e = clean(raw);
    if (e && !found.has(e)) found.set(e, { email: e, source: pageUrl, how });
  };
  for (const m of String(html).matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try { add(decodeURIComponent(m[1]), "mailto"); } catch { add(m[1], "mailto"); }
  }
  for (const m of String(html).matchAll(/data-cfemail="([0-9a-f]+)"/gi)) add(deCf(m[1]), "cloudflare");
  for (const m of String(html).matchAll(/email-protection#([0-9a-f]+)/gi)) add(deCf(m[1]), "cloudflare");
  for (const m of strip(String(html)).matchAll(EMAIL)) add(m[0], "text");
  return [...found.values()];
}

/** The surname of the decision maker the registry named, if there is one. */
export function surnameOf(officialName) {
  const words = String(officialName || "").toLowerCase().split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, "")).filter((w) => w.length >= 3);
  return words.length ? words[words.length - 1] : "";
}

export function scoreEmail(cand, website, officialName) {
  const local = localOf(cand.email);
  let s = 0;
  if (sameDomain(cand.email, website)) s += 100;
  if (cand.how === "mailto") s += 10;
  else if (cand.how === "cloudflare") s += 8;
  if (FRONT_DESK.test(local)) s += 20;
  if (WRONG_DOOR.test(local)) s -= 40;
  const sur = surnameOf(officialName);
  if (sur && local.includes(sur)) s += 15;
  s -= Math.min(local.length, 24) / 100; // tiebreak only: prefer the shorter one
  return s;
}

/** The best address found, with whether its domain proves it is theirs. */
export function pickEmail(cands, website, officialName) {
  const scored = (cands || []).map((c) => ({
    ...c,
    score: scoreEmail(c, website, officialName),
    own: sameDomain(c.email, website),
    free: FREEMAIL.test(domainOf(c.email)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);

  const todo = (list || [])
    .filter((p) => p.website && !p.email && !p.do_not_contact)
    .slice(0, cap);

  console.log(`${todo.length} practices with a website and no address on file.\n`);
  const today = new Date().toISOString().slice(0, 10);
  let saved = 0, offDomain = 0, none = 0, unreadable = 0;

  for (const p of todo) {
    const cands = [];
    let read = 0;
    for (const u of pagesFor(p.website)) {
      const r = await get(u);
      if (!r.html) continue;
      read++;
      cands.push(...emailsOn(r.html, r.url));
      // Stop as soon as the practice's own domain has turned up. A later page
      // can only offer another address at the same domain.
      if (cands.some((c) => sameDomain(c.email, p.website))) break;
      await new Promise((x) => setTimeout(x, 150));
    }

    const site = `https://${String(p.website).replace(/^https?:\/\//, "")}`;
    const best = pickEmail(cands, p.website, p.official_name);
    const others = [...new Set(cands.map((c) => c.email))].filter((e) => e !== best?.email);

    let row, save = null;
    if (best?.own) {
      row = {
        claim: `Email ${best.email} is published on the practice's own website.`,
        source: best.source, checked_on: today, proven: true,
      };
      save = { id: p.id, email: best.email };
      saved++;
      console.log(`FOUND      ${p.name}\n           ${best.email}  (${best.how})  on  ${best.source}`);
      if (others.length) console.log(`           also on the page, not used: ${others.join(", ")}`);
    } else if (best) {
      // An address at a domain that is not theirs may still be theirs, and may
      // be their web designer's. The CRM does not get a guess: gate 3 would
      // pass whatever is in the column, so the decision belongs to a person.
      row = {
        claim: `The practice's website shows ${best.email}, but that address is at ${registrable(domainOf(best.email))} while the website is ${registrable(p.website)}, so it is NOT established as theirs.`,
        source: best.source, checked_on: today, proven: false,
      };
      offDomain++;
      console.log(`OFF-DOMAIN ${p.name}\n           ${best.email}${best.free ? " (free mailbox)" : ""} on ${best.source}, not at ${registrable(p.website)}. Needs a human.`);
    } else if (read === 0) {
      row = {
        claim: `Could not read any page of the practice's website, so whether they publish an address is still unknown. Nothing is established either way.`,
        source: site, checked_on: today, proven: false,
      };
      unreadable++;
      console.log(`UNREADABLE ${p.name}\n           ${p.website} served no page`);
    } else {
      row = {
        claim: `No email address is published on any of the ${read} pages of the practice's own website that could be read.`,
        source: site, checked_on: today, proven: false,
      };
      none++;
      console.log(`NONE       ${p.name}\n           nothing on ${read} readable pages of ${p.website}`);
    }

    if (!write) continue;
    const { error: e } = await sb.rpc("crm_save", {
      p: { ...(save || { id: p.id }), evidence: merge(p.evidence, [row], "email-source") },
    });
    if (e) console.log(`           FAILED: ${e.message}`);
  }

  console.log(`\n${saved} addresses proven on the practice's own domain and now sendable.`);
  console.log(`${offDomain} found at a different domain, left out of the CRM for a human to judge.`);
  console.log(`${none} sites published no address. ${unreadable} sites served no page at all.`);
  console.log(write ? "Saved." : "dry run. pass --write to save.");
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
