// Write the cold email FROM the evidence, or refuse to write it.
//
// WHY THIS EXISTS. The first batch was written by hand: a frame Noah approved,
// plus a paragraph per practice that I researched. One of those paragraphs said
// "you're already writing posts for the site" to a practice with no blog,
// because the frame got personalised and the facts did not. Noah: "if we're
// just making them arbitrarily and it's just the same format for all of them,
// then we're not actually finding stuff for these businesses."
//
// So the observation paragraph is now DERIVED from the prospect's evidence, and
// only from rows marked proven. A fact that is not in the evidence table cannot
// reach the email, because there is nowhere for it to come from.
//
// And it REFUSES more often than it writes. A draft needs both:
//   1. a named decision maker, so it is addressed to a person
//   2. one proven fact the email is built on (missing site basics, booking tool)
// Missing either prints the reason and produces nothing.
//
//   node src/outreach-draft.mjs [--out=drafts.json] [--limit=N]
//
// Then read every draft, then:
//   node src/outreach-send.mjs <drafts.json> --preview=noah@watsonsmedia.com --write

import { writeFileSync } from "node:fs";
import { openStore } from "./lib/store.mjs";
import { bareSite } from "./outreach-gates.mjs";

/** "Alex Morgan, MD" -> "Dr Morgan". "Marco Reyes, LMFT" -> "Marco". */
export function greet(officialName) {
  if (!officialName) return null;
  const [full, ...creds] = String(officialName).split(",");
  const cred = creds.join(" ");
  // An honorific on the front says the same thing as letters on the end, and a
  // record may carry only one of the two. A practice homepage signed "-Dr. Rowan
  // Hale" gives no credential to read, and inventing a PhD to make the
  // greeting work would be exactly the sort of made-up fact the gates exist to
  // stop. The \s is required so "Drew" is not read as "Dr" plus "ew".
  const honorific = /^(dr|doctor|prof|professor)\.?\s/i.test(full.trim());
  const parts = full.trim().replace(/^(dr|doctor|prof|professor)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const surname = parts[parts.length - 1];
  // A doctorate is addressed by title. Everything else by first name, because
  // "Dr Reyes" to an LMFT is worse than being too casual.
  if (honorific || /\b(MD|M\.D|DO|D\.O|PhD|Ph\.?D|PsyD|Psy\.?D|DNP|EdD)\b/i.test(cred)) return `Dr. ${surname}`;
  return parts[0];
}

const proven = (p) => (Array.isArray(p.evidence) ? p.evidence : []).filter((e) => e.proven);

/**
 * Article titles prospect-articles.mjs read off their own pages, longest first.
 *
 * Longest first because a short one is usually a section name that slipped the
 * filter. These are only ever shown or quoted, never paraphrased.
 */
export function titlesOf(p) {
  return proven(p)
    .map((e) => e.claim.match(/^Article published on the practice's own site, titled "(.+)"\.$/)?.[1])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}
const has = (p, re) => proven(p).find((e) => re.test(e.claim));

/**
 * The emails Noah approved on 2026-11-02 (three, until the Maps one was cut the same day), after "what are we exactly pitching these people?
 * ... they don't care about anything else other than making money." Each one says
 * "I noticed X, so I want to do Y", then the one result we can prove, then a reply ask.
 * Social-gap lines ("the only people who see them had already found you") are gone: he
 * said they made no sense. No price in any of them: a reply gets a call, the quote comes after.
 *
 * The proof is a client's GoHighLevel readout on a 2026-09-06 interview recording: 6 to 7 contact
 * forms a week from the posts, 37% booked. Noah chose to use it as it stands.
 */
const SIGN = `Noah Watson
Watson's Media`;

// The Maps-rank email is gone (Noah, 2026-11-02, "cut it"): three checks in one afternoon
// moved every rank, so the number could be wrong by the time she read it. Never quote a rank.

/** 1. The site is missing the basics Google reads: the small, cheap job that gets us in the door. */
function seoEmail(p, hi) {
  const title = has(p, /^Homepage title is only "(.+)"\.$/);
  if (!has(p, /^No sitemap/i) || !has(p, /^No robots\.txt/i) || !title) return null;
  const site = bareSite(p.website);
  const t = title.claim.match(/^Homepage title is only "(.+)"\.$/)[1];
  return {
    subject: `${site} on Google`,
    help: `${site} has no sitemap, no robots.txt, and its page title is just "${t}". How we'd help: 1) add a sitemap and a robots.txt; 2) rewrite the page title and description around what they treat and where; 3) submit the site to Google Search Console, so Google reads it and we can see which searches bring people in.`,
    text: `Hi ${hi},

I looked at ${site} and it's missing a few basics that help Google read and list a site. There's no sitemap, no robots.txt, and the page title just says "${t}".

It's a small fix, and I'd like to do it for you so more people searching for a therapist find you.

Reply and I'll send over exactly what I'd change.

${SIGN}`,
  };
}

/** 2. They book through an outside tool, where the trail of how someone found them stops. */
function trackingEmail(p, hi) {
  const booking = has(p, /^Takes bookings through (.+?)\./i);
  if (!booking) return null;
  const tool = booking.claim.match(/^Takes bookings through (.+?)\./i)[1];
  return {
    subject: "where your new clients come from",
    help: `New clients book through ${tool}, so the trail of how they found the practice stops there. How we'd help: 1) add a "how did you hear about us?" question to the ${tool} intake; 2) put tracked links on their Google listing and any social bios; 3) send a monthly count of new clients by source, with no patient details in it.`,
    text: `Hi ${hi},

Clients book with you through ${tool}, but can you tell how each of them found you first? Google, a referral, somewhere else?

I want to set that up for you, so you can see which one is bringing in patients and put your money there.

At a psychiatry practice I work with, we can see it: about one new patient inquiry a day comes from their posts, and over a third of those book.

I've got three things I'd set up first. Reply and I'll send them over.

${SIGN}`,
  };
}

export function draftFor(p) {
  if (p.do_not_contact) return { skip: "do_not_contact is set" };
  // Law and insurance offices Noah walks into: the email copy is written for mental health practices.
  if (p.channel === "in_person") return { skip: "in-person visits only" };
  if (!p.email) return { skip: "no email address" };
  if (p.stage !== "lead") return { skip: `already at stage "${p.stage}"` };
  // Both read fine and pass every gate, and reading the 2026-10-31 batch caught one of each.
  if (/^(billing|accounting|invoices?|records|fax)@/i.test(p.email)) return { skip: "the only address is a billing or records inbox" };
  if (/^staff\b/i.test(p.official_title || "")) return { skip: "the named person is staff, not someone who decides" };
  const hi = greet(p.official_name);
  if (!hi) return { skip: "no named decision maker, and nobody opens an email to nobody" };
  if (!bareSite(p.website)) return { skip: "no website on the record, so there is nothing to have looked at" };
  // A missing file they can check beats a question.
  const m = seoEmail(p, hi) || trackingEmail(p, hi);
  if (!m) return { skip: "no missing site basics, no booking tool: nothing true to say yet" };
  // The "how we'd help" note is what Noah reads on the profile when they reply (2026-11-02).
  const { help, ...email } = m;
  return { website: p.website, to: p.email, ...email, angle: help, next_action: "Follow up if no reply", official: p.official_name, titles: titlesOf(p) };
}

async function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith("--out="))?.slice(6) || "drafts.json";
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);

  const drafts = [];
  const refused = new Map();
  // One person can be the authorized official on several practices. Four people
  // run nine of these, so without this they each get up to three identical emails.
  const peopleWritten = new Set();

  for (const p of list || []) {
    const d = draftFor(p);
    if (d.skip) {
      refused.set(d.skip, (refused.get(d.skip) || 0) + 1);
      continue;
    }
    const who = String(d.official).toLowerCase();
    if (peopleWritten.has(who)) {
      refused.set("the same person is already being written to about another practice", (refused.get("the same person is already being written to about another practice") || 0) + 1);
      continue;
    }
    peopleWritten.add(who);
    drafts.push(d);
    if (drafts.length >= cap) break;
  }

  for (const d of drafts) console.log(`\n=== ${d.to}  (${d.website})\nSubject: ${d.subject}\n\n${d.text}`);
  console.log(`\n${drafts.length} drafts written.`);
  if (refused.size) {
    console.log("\nnot written, and why:");
    for (const [why, n] of [...refused].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${why}`);
  }
  if (drafts.length) {
    writeFileSync(out, JSON.stringify(drafts.map((d) => ({
      website: d.website, to: d.to, subject: d.subject, text: d.text,
      next_action: d.next_action, due: dueDate(),
    })), null, 1));
    console.log(`\nwritten to ${out}. READ THEM, then send with outreach-send.mjs --preview first.`);
  }
}

/** A week out, which is what the earlier batch used. */
function dueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
