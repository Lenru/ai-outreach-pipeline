// The four things that must be true before a cold email leaves this machine.
//
// No IO in here, so every gate is provable without Resend, a database or a
// network. outreach-send.mjs calls these; it does not reimplement them.
//
// Each gate exists because of something that already went wrong or is known to
// go wrong at volume:
//
//  1. FOOTER      CAN-SPAM requires a working opt-out and a physical postal
//                 address in every commercial email. Without it each send is a
//                 separate violation. The address is configuration, never a
//                 literal in code, and an unset address blocks the send rather
//                 than shipping a blank line.
//  2. STOP LIST   Emailing someone who said stop is the one thing that turns a
//                 cold campaign into a complaint. Checked at SEND time against
//                 the CRM's own touches, because a draft written on Monday can
//                 be sent on Friday after they replied.
//  3. TEXT        Run on the EXACT subject and body going out. A cold email
//                 already went to a practice claiming "you're already writing
//                 posts for the site" when they had no blog (the mistakes log: "A
//                 cold email claimed a fact a regex invented"), and an LLM lead-finder has
//                 invented contact details before (the mistakes log: "an LLM lead-finder
//                 invents contact details for lead enrichment"). So: every
//                 claim must trace to a proven evidence row, the address must
//                 have been read off the practice's own site, and Noah's
//                 em-dash rule is enforced on the final bytes.
//  4. DAILY CAP   watsonsmedia.com is new to sending. A new domain that emits
//                 200 cold emails in an hour gets classified as spam, and that
//                 reputation damage hits every other email from the domain too.

export const DAILY_CAP = 20;

/** Proven evidence rows only. An unproven row must never support a claim. */
const proven = (p) => (Array.isArray(p?.evidence) ? p.evidence : []).filter((e) => e?.proven);
const find = (p, re) => proven(p).find((e) => re.test(e.claim));

// ---------------------------------------------------------------- gate 1

const OPT_OUT = `Reply "stop" and I won't email you again.`;

/**
 * The CAN-SPAM footer, or a refusal.
 *
 * Deliberately strict about what counts as an address: a placeholder is worse
 * than nothing, because it looks compliant and is not.
 */
export function footer(address) {
  const a = String(address || "").trim();
  if (!a) return { error: "OUTREACH_POSTAL_ADDRESS is not set. CAN-SPAM needs a real postal address in every commercial email." };
  if (/\b(your address|tbd|todo|xxx|placeholder|street name|123 main)\b/i.test(a)) {
    return { error: `OUTREACH_POSTAL_ADDRESS looks like a placeholder: "${a}"` };
  }
  // A postal address has at least a number or a PO box, and a comma or line break.
  if (!/\d/.test(a) || a.length < 12) {
    return { error: `OUTREACH_POSTAL_ADDRESS does not look like a postal address: "${a}"` };
  }
  return { text: `${OPT_OUT}\n${a.replace(/\s*\n\s*/g, ", ")}` };
}

/** The body with the footer on it. Idempotent: never adds a second one. */
export function withFooter(body, address) {
  const f = footer(address);
  if (f.error) return f;
  if (body.includes(OPT_OUT)) return { text: body };
  return { text: `${body.replace(/\s+$/, "")}\n\n${f.text}` };
}

// ---------------------------------------------------------------- gate 2

// What a person writes when they want it to stop. Checked on their reply only,
// never on our own sent copy, or the word "stop" in our own footer would match.
const STOP_WORDS =
  /\b(stop|unsubscribe|unsubscribed|remove me|take me off|opt ?out|do not (email|contact)|don'?t (email|contact) me|no longer|not interested|no thanks?|no thank you|cease)\b/i;

// A bounce or an auto-reject, however the provider words it.
const BOUNCE =
  /\b(bounced|mailer-?daemon|delivery (status notification|has failed|failed)|undeliverable|address not found|user unknown|recipient (address )?rejected|550|mailbox (is )?full|does not exist|no such user)\b/i;

/**
 * Whether this prospect must never be emailed again, and why.
 *
 * `touches` is the CRM's own list for that prospect. A reply is recorded with a
 * body starting "REPLY from <addr>" (src/prospect-reply.gs), which is how an
 * inbound message is told apart from our own "SENT ..." copy. Our sent bodies
 * quote nothing of theirs, but they do contain the footer's own "stop", so
 * matching the wrong direction would block every second send.
 *
 * `to` is the address about to be mailed. A bounce that names other addresses
 * only stops those (hello@ bounced, info@ was resent and delivered). A bounce
 * naming no address, or a send with no `to`, still stops everything.
 */
export function stopped(prospect, touches = [], to = null) {
  if (prospect?.do_not_contact) return { stop: "do_not_contact is set on the record" };
  // prospect-recon.mjs proves this from the practice's own site (src/lib/prospect-size.mjs).
  const owned = (Array.isArray(prospect?.evidence) ? prospect.evidence : [])
    .find((e) => e?.proven && /^Owned by a large organisation/.test(e.claim));
  if (owned) return { stop: owned.claim };
  for (const t of touches) {
    const body = String(t?.body || "");
    const inbound = /^REPLY from/i.test(body.trim());
    if (inbound && STOP_WORDS.test(body)) {
      return { stop: `they replied asking to stop: "${body.split("\n").slice(-1)[0].trim().slice(0, 90)}"` };
    }
    // A bounce can be recorded either way round, by the reply hook or by hand.
    if (BOUNCE.test(body)) {
      // "Resend to info@" names the address that WORKED; the bounce's own sender is not a recipient.
      const named = (body.replace(/\bresen[dt] to \S+/gi, "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((a) => a.toLowerCase())
        .filter((a) => !a.endsWith("@watsonsmedia.com") && !/^(mailer-daemon|postmaster)@/.test(a));
      const elsewhere = to && named.length && !named.includes(String(to).toLowerCase());
      if (!elsewhere) return { stop: "a previous email to this address bounced" };
    }
  }
  return null;
}

// ---------------------------------------------------------------- gate 3

/**
 * Claims the drafter can make, and the evidence each one requires.
 *
 * This is a closed list on purpose. The drafter's vocabulary is finite
 * (outreach-draft.mjs), so anything in the body that looks like one of these
 * assertions can be checked against the evidence table. A sentence that makes
 * an assertion NOT on this list is caught by the catch-all below it.
 */
const CLAIM_RULES = [
  {
    // The drafter names the domain ("publishing on drquill.example"), which "on the site" never matched.
    says: /you'?re publishing on|you are publishing on/i,
    needs: /^Publishes on the site: \d+ article/i,
    why: "says they publish on the site",
  },
  {
    says: /already a video on the site/i,
    needs: /video is embedded on the site/i,
    why: "says there is a video on the site",
  },
  {
    says: /there'?s no social account linked anywhere on it/i,
    needs: /^No social account is linked anywhere on the site/i,
    why: "says no social account is linked",
  },
  {
    // "is a LinkedIn page" since 2026-10-18; the old "is one linkedin page" pattern
    // stopped matching then, and the claim went out unchecked (and false) for a week.
    says: /the only social account linked from the site is (?:one|an?) (\w+)/i,
    needs: /^Links one (\w+) account/i,
    why: "says exactly one social account is linked",
    sameCapture: true,
    exactlyOne: true,
  },
  {
    says: /you take bookings through ([A-Za-z][\w/ .-]{2,20}?)(?: on |[,.])/i,
    needs: /^Takes bookings through (.+?)\./i,
    why: "names a booking tool",
    sameCapture: true,
  },
  // The 2026-11-02 emails (outreach-draft trackingEmail, seoEmail).
  {
    says: /book with you through ([A-Za-z][\w/ .-]{2,20}?),/i,
    needs: /^Takes bookings through (.+?)\./i,
    why: "names a booking tool",
    sameCapture: true,
  },
  {
    says: /there'?s no sitemap/i,
    needs: /^No sitemap/i,
    why: "says the site has no sitemap",
  },
  {
    says: /no robots\.txt/i,
    needs: /^No robots\.txt/i,
    why: "says the site has no robots.txt",
  },
  {
    says: /page title just says "([^"]+)"/i,
    needs: /^Homepage title is only "(.+)"\.$/i,
    why: "quotes their page title",
    sameCapture: true,
  },
  // The Maps email (outreach-draft mapsEmail). Each number is checked against the prospect-rank row.
  {
    says: /searched "([^"]+)" on Google Maps/i,
    needs: /^Ranks \d+ on Google Maps for "([^"]+)"/i,
    why: "names a Google Maps search",
    sameCapture: true,
  },
  {
    says: /you c[oa]me up (\d+)(?:st|nd|rd|th)/i,
    needs: /^Ranks (\d+) on Google Maps/i,
    why: "gives a Google Maps position",
    sameCapture: true,
  },
  {
    says: /(?:Above you (?:are|is)|The top three are) (.+?)\. You/i,
    needs: /; (?:above it are|the top three are) (.+)\.$/i,
    why: "describes the listings above them",
    sameCapture: true,
  },
  {
    says: /You have (\d+)\./,
    needs: /^Ranks \d+ on Google Maps for "[^"]+" with (\d+) reviews?/i,
    why: "gives their review count",
    sameCapture: true,
  },
  {
    says: /You don't have any yet/,
    needs: /^Ranks \d+ on Google Maps for "[^"]+" with 0 reviews/i,
    why: "says they have no reviews",
  },
  {
    // The drafter says "You have 16 clinicians on brightoak.com" since the team branch; the old
    // pattern alone let that count through unchecked (2026-11-02).
    says: /(\d+) clinicians (?:with their own pages|on )/i,
    needs: /^(\d+) clinicians named on the site/i,
    why: "gives a number of clinicians",
    sameCapture: true,
  },
];

/** "https://www.example.com/" -> "example.com". Maps leads store full URLs; registry leads store bare domains. */
export const bareSite = (url) => String(url || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");

/** A domain mentioned in the text, so a body cannot name somebody else's site. */
const DOMAINS = /\b((?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|health|io|co|us|info|care|clinic))\b/gi;
const OURS = /^(watsonsmedia\.com|google\.com|google\.co\.uk)$/i;

/** Claims in `body` that the prospect's proven evidence does not back. Empty means all hold. */
export function claimFails(body, prospect) {
  const fails = [];
  for (const rule of CLAIM_RULES) {
    const said = body.match(rule.says);
    if (!said) continue;
    const ev = find(prospect, rule.needs);
    if (!ev) {
      fails.push(`${rule.why}, and no proven evidence says so`);
      continue;
    }
    // One evidence row per platform, so two rows means "the only" is false.
    if (rule.exactlyOne) {
      const n = proven(prospect).filter((e) => rule.needs.test(e.claim)).length;
      if (n !== 1) { fails.push(`${rule.why}, but the evidence records ${n}`); continue; }
    }
    if (rule.sameCapture) {
      const norm = (s) => String(s || "").trim().toLowerCase().replace(/^x$/, "twitter");
      const a = norm(said[1]);
      const b = norm(ev.claim.match(rule.needs)[1]);
      if (a !== b) fails.push(`${rule.why} as "${a}", but the evidence says "${b}"`);
    }
  }
  return fails;
}

/**
 * Everything wrong with the exact text about to be sent. Empty array means send.
 *
 * `email` is the recipient being used, checked against the evidence for where
 * it was read from, because an LLM lead-finder has invented plausible contact details
 * before and a plausible wrong address is worse than a missing one.
 */
export function textGate({ subject, body, prospect, email }) {
  const fails = [];
  const text = `${subject}\n${body}`;

  // Noah's hard rule, on the final bytes rather than the draft.
  if (/[\u2014\u2013]/.test(text)) fails.push("contains an em-dash or en-dash");
  if (/[“”‘’]/.test(text)) fails.push("contains curly quotes, which do not survive plain text cleanly");

  // A named person. "Hello," is the arbitrary mail-merge greeting.
  const official = String(prospect?.official_name || "").split(",")[0].trim();
  const parts = official.split(/\s+/).filter(Boolean);
  if (!official) fails.push("no named decision maker on the record");
  else if (!parts.some((n) => n.length > 2 && body.includes(n))) {
    fails.push(`the body does not name ${official}`);
  }
  if (/^\s*(hi|hello|hey)\s*,/im.test(body) && !parts.some((n) => body.includes(n))) {
    fails.push("greets nobody by name");
  }

  // The footer. Gate 1 builds it; this checks it actually survived to the body.
  if (!body.includes(OPT_OUT)) fails.push("no opt-out line in the body");

  // Every claim traces to proven evidence.
  fails.push(...claimFails(body, prospect));

  // A quoted title must be one the evidence actually recorded. Without this the
  // drafter could quote anything and the gate would wave it through, which is
  // the same hole as the claim that started all of this.
  for (const m of body.matchAll(/"([^"]{10,120})" is the kind of thing/g)) {
    const quoted = m[1];
    const ok = proven(prospect).some(
      (e) => /^Article published on the practice's own site, titled "/.test(e.claim) && e.claim.includes(`"${quoted}"`),
    );
    if (!ok) fails.push(`quotes "${quoted}" as something they wrote, and no proven evidence records that article`);
  }

  // No domain in the body except the prospect's own and ours.
  const site = bareSite(prospect?.website);
  for (const m of text.matchAll(DOMAINS)) {
    const d = m[1].toLowerCase().replace(/^www\./, "");
    if (d === site || OURS.test(d)) continue;
    if (email && d === String(email).split("@")[1]?.toLowerCase()) continue;
    fails.push(`mentions ${d}, which is neither their site nor ours`);
  }

  // The address was read off the practice's own site.
  if (!email) fails.push("no recipient address");
  else {
    const src = proven(prospect).find(
      (e) => e.claim.toLowerCase().includes(String(email).toLowerCase()) && /^https?:\/\//.test(e.source || ""),
    );
    if (!src) {
      fails.push(`no proven evidence records where ${email} was read from, so it cannot be trusted`);
    } else {
      let host = "";
      try { host = new URL(src.source).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* bad url */ }
      if (site && host !== site && !host.endsWith(`.${site}`)) {
        fails.push(`${email} was recorded from ${host || "an unreadable source"}, not from ${site}`);
      }
    }
  }
  return fails;
}

// ---------------------------------------------------------------- gate 4

/** Sends we made today. A reply is not a send, and must not eat the quota. */
export function sentToday(touches = [], today = new Date().toISOString().slice(0, 10)) {
  return touches.filter(
    (t) => t?.kind === "email" && /^SENT\b/i.test(String(t.body || "").trim()) && String(t.at || "").slice(0, 10) === today,
  ).length;
}

/**
 * How many more may go out today.
 *
 * `cap` may only LOWER the limit. Raising it is a deliberate decision about the
 * domain's reputation and does not belong in a command-line flag.
 */
export function remainingToday(alreadySent, cap = DAILY_CAP) {
  const limit = Math.min(Number.isFinite(cap) ? cap : DAILY_CAP, DAILY_CAP);
  return Math.max(0, limit - alreadySent);
}
