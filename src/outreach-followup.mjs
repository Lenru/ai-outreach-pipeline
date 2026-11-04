// Draft the follow-ups that are due, for Noah to read before anything sends.
//
// Two follow-ups, a week apart, then it stops for good (wording approved by Noah
// 2026-10-15). Like outreach-draft.mjs it writes a drafts file and sends nothing;
// outreach-send.mjs is still the only thing that mails anyone, with all four gates.
//
// A follow-up is held for ANY reply, not only "stop": someone who wrote back is
// owed an answer, not a chaser. outreach-send's gate 2 re-checks stop words at
// send time too.
//
//   node src/outreach-followup.mjs [--out=file.json] [--today=YYYY-MM-DD]
//
// Then, after reading them:
//   node src/outreach-send.mjs <file.json> --write

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openStore } from "./lib/store.mjs";
import { greet } from "./outreach-draft.mjs";
import { stopped, claimFails } from "./outreach-gates.mjs";

// Not "Re:": these go out as a new email, and a fake reply subject is a spam
// tactic CAN-SPAM treats as misleading (Noah, 2026-10-15). The quote below
// carries the context instead.
// Plain, because the first email may have been about social, the site or bookings (Noah, 2026-11-02).
const SUBJECT = "Following up";

/**
 * The first cold email, quoted, so the follow-up carries its own context.
 * Only from a full "SENT" touch (outreach-send.mjs); a hand-logged note has no
 * body to quote, and then the follow-up goes without one. The old footer is cut,
 * or withFooter would see its opt-out line and skip the new footer at the bottom.
 */
export function quoteOriginal(bodies) {
  const b = bodies.find((x) => /^SENT \d{4}-\d{2}-\d{2}/.test(x) && !x.includes("\nTag: "));
  if (!b) return "";
  const text = b.slice(b.indexOf("\n\n") + 2).split(`Reply "stop"`)[0].trim();
  if (!text) return "";
  const day = new Date(`${b.slice(5, 15)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `\n\nOn ${day}, Noah Watson wrote:\n${text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}`;
}

const TEXT = {
  "followup-1": (hi, site) => `Hi ${hi},

Following up on my note from last week. I'm local. If you reply, I'll look at ${site} and your Google listing and send back the first thing I'd change.

Noah`,
  "followup-2": (hi, site) => `Hi ${hi},

I haven't heard back, so I'll take it the timing isn't right and won't keep filling your inbox. If that changes, just reply here and I'll take a look at ${site}.

Noah`,
};

/** Local New York date, YYYY-MM-DD. toISOString() is UTC and is tomorrow every evening. */
export function nyDate(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const plusDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The follow-up this prospect is due today, or why there isn't one. */
export function planFollowup(p, touches, today) {
  if (p.do_not_contact) return { skip: "do not contact" };
  const halt = stopped(p, touches, p.email);
  if (halt) return { skip: halt.stop };
  if (p.stage !== "contacted") return { skip: `stage is ${p.stage}` };
  if (!p.next_action_due || p.next_action_due > today) return { skip: "not due yet" };
  const bodies = touches.map((t) => String(t?.body || "").trim());
  if (bodies.some((b) => /^REPLY from/i.test(b))) return { skip: "they replied, answer them instead" };
  const hi = greet(p.official_name);
  if (!hi) return { skip: "no named decision maker" };
  const sent = (tag) => bodies.some((b) => b.includes(`Tag: ${tag}`));
  const site = String(p.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  // A quote repeats the first email's claims. If one no longer holds against the
  // evidence (a false "only social account" went out 2026-10-20), send it without.
  const quoted = quoteOriginal(bodies);
  // Nor a Google rank: they move by the hour, so an old one reads as wrong (Noah, 2026-11-02).
  const quote = claimFails(quoted, p).length || /\b(?:came|come|comes) up \d+(?:st|nd|rd|th)\b|\branks? \d+/i.test(quoted) ? "" : quoted;
  if (!sent("followup-1")) {
    return { draft: { website: p.website, to: p.email, subject: SUBJECT, tag: "followup-1",
      text: TEXT["followup-1"](hi, site) + quote,
      next_action: "Last follow-up if no reply", due: plusDays(today, 7) } };
  }
  if (!sent("followup-2")) {
    return { draft: { website: p.website, to: p.email, subject: SUBJECT, tag: "followup-2",
      text: TEXT["followup-2"](hi, site) + quote, next_action: "No response after two follow-ups. Stop.", due: null } };
  }
  return { skip: "both follow-ups already sent" };
}

async function main() {
  const args = process.argv.slice(2);
  // --today=YYYY-MM-DD previews a future day; drafts only, nothing sends from here.
  const today = args.find((a) => a.startsWith("--today="))?.slice(8) || nyDate();
  const out = args.find((a) => a.startsWith("--out="))?.slice(6) || `followups-${today}.json`;
  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);

  const drafts = [], held = [];
  for (const p of (list || []).filter((x) => x.stage === "contacted")) {
    const { data: rec, error: e } = await sb.rpc("crm_get", { p_id: p.id });
    if (e) throw new Error(`crm_get: ${e.message}`);
    const r = planFollowup(p, rec?.touches || [], today);
    if (r.draft) { drafts.push({ ...r.draft, name: p.name }); console.log(`\n=== ${p.name}  ${r.draft.to}  [${r.draft.tag}]\n${r.draft.text}`); }
    else held.push(`${p.name}: ${r.skip}`);
  }
  console.log(`\n${drafts.length} follow-ups due.${held.length ? `\nnot due or held:\n  ${held.join("\n  ")}` : ""}`);
  if (!drafts.length) return;
  writeFileSync(out, JSON.stringify(drafts, null, 1));
  console.log(`\nwritten to ${out}. Read them, then: node src/outreach-send.mjs ${out} --write`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
