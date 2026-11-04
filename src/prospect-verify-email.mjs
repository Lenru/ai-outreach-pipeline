// Prove where a prospect's email address came from, or say it cannot be proved.
//
// Gate 3 in outreach-gates.mjs refuses to email an address unless a proven
// evidence row records a source URL on the practice's own domain. The twelve
// addresses already in the CRM were entered by hand with a note saying "from
// the practice's own website", which is not a URL and not checkable, so all of
// them are blocked. The mistakes log has the reason this is strict: an LLM lead-finder has
// invented plausible contact details before, and a plausible wrong address is
// worse than a missing one.
//
// So this re-reads each practice's own pages and looks for the exact address.
// Found: an evidence row with the page it was on. Not found: a row saying so,
// proven false, and the address stays unsendable. Never a guess either way.
//
// Dry run unless --write.
//
//   node src/prospect-verify-email.mjs [--write] [--limit=N]

import { openStore } from "./lib/store.mjs";
import { merge } from "./lib/evidence.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Where a practice puts its address, in the order it is usually on.
const PATHS = ["", "/contact", "/contact-us", "/contact.html", "/contactus", "/about", "/about-us", "/staff", "/team", "/our-team", "/appointments", "/new-patients"];

// Exported so prospect-find-email.mjs fetches pages exactly the way this does,
// rather than growing a fifth private copy of the same two helpers.
export const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ").trim();

export async function get(url, ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: c.signal, headers: { "user-agent": UA, accept: "text/html,*/*" } });
    return { status: r.status, url: r.url, html: r.status === 200 ? await r.text() : "" };
  } catch {
    return { status: 0, url, html: "" };
  } finally { clearTimeout(t); }
}

/**
 * Is this exact address on this page?
 *
 * Checked in the raw HTML and in the stripped text, because an address can be
 * in a mailto: href, in visible text, or in both. Case-insensitive, since a
 * site may title-case what the inbox does not.
 */
export function addressOn(html, email) {
  const needle = String(email || "").toLowerCase();
  if (!needle.includes("@")) return false;
  return html.toLowerCase().includes(needle) || strip(html).toLowerCase().includes(needle);
}

/** Pages to try for one practice, its own domain only. */
export function pagesFor(website) {
  const base = String(website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!base) return [];
  return PATHS.map((p) => `https://${base}${p}`);
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);

  const todo = (list || []).filter((p) => {
    if (!p.email || !p.website) return false;
    const proven = (Array.isArray(p.evidence) ? p.evidence : []).filter((e) => e.proven);
    // Already has a row naming this address with a real URL behind it.
    return !proven.some((e) => e.claim.toLowerCase().includes(p.email.toLowerCase()) && /^https?:\/\//.test(e.source || ""));
  }).slice(0, cap);

  console.log(`${todo.length} addresses with no proven source.\n`);
  const today = new Date().toISOString().slice(0, 10);
  let found = 0, missing = 0, blocked = 0;

  for (const p of todo) {
    let hit = null;
    let read = 0; // pages that actually loaded, as opposed to pages we tried
    for (const u of pagesFor(p.website)) {
      const r = await get(u);
      if (!r.html) continue;
      read++;
      if (addressOn(r.html, p.email)) { hit = r.url; break; }
      await new Promise((x) => setTimeout(x, 150));
    }

    const site = `https://${String(p.website).replace(/^https?:\/\//, "")}`;
    // "We read their site and the address is not on it" and "their site would
    // not load" are different findings and must not share a sentence. The first
    // is evidence about the address. The second is evidence about nothing, and
    // reporting it as absence is the same mistake as claiming a blog existed
    // because a regex matched a nav word.
    const row = hit
      ? { claim: `Email ${p.email} is published on the practice's own website.`, source: hit, checked_on: today, proven: true }
      : read === 0
        ? {
            claim: `Could not read any page of the practice's website, so where ${p.email} came from is still unknown. Nothing is established either way.`,
            source: site, checked_on: today, proven: false,
          }
        : {
            claim: `Email ${p.email} is NOT published on any of the ${read} pages of the practice's own website that could be read, so where it came from is unknown.`,
            source: site, checked_on: today, proven: false,
          };

    if (hit) { found++; console.log(`FOUND      ${p.name}\n           ${p.email}  on  ${hit}`); }
    else if (read === 0) { blocked++; console.log(`UNREADABLE ${p.name}\n           ${p.website} served no page, so nothing was established about ${p.email}`); }
    else { missing++; console.log(`NOT FOUND  ${p.name}\n           ${p.email} is on none of the ${read} readable pages of ${p.website}`); }

    if (!write) continue;
    const { error: e } = await sb.rpc("crm_save", {
      p: { id: p.id, evidence: merge(p.evidence, [row], "email-source") },
    });
    if (e) console.log(`        FAILED: ${e.message}`);
  }

  console.log(`\n${found} proven and now sendable. ${missing} where the site was read and the address was absent. ${blocked} whose site could not be read at all.`);
  if (blocked) console.log("An unreadable site establishes nothing: those addresses are neither confirmed nor disproved.");
  console.log(write ? "Saved." : "dry run. pass --write to save.");
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
