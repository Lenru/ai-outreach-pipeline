// Two facts a cold email depends on, read off the practice's own site. No model,
// no search API: plain regex over pages prospect-recon.mjs already fetched.
//
// 1. OWNED BY A BIG SYSTEM. A practice owned by Northwell, a hospital group or a
//    national chain does not hire a one-person studio and does not answer cold
//    email. The registry filter in prospect-find.mjs catches the ones NAMED after
//    the system; this catches the ones that keep their own name. A bio saying a
//    doctor "trained at Mount Sinai" must NOT count, so a hospital system only
//    counts next to ownership wording, a copyright line, or the site living on its domain.
//    A chain counts anywhere on its own site, because only the chain says its name.
// 2. SIZE. Clinicians named on the home and team pages decide which offer fits.

// Hospital systems around the Hudson Valley and NYC. Name pattern, then domain.
const SYSTEMS = [
  ["Northwell Health", /northwell/i, "northwell.edu"],
  ["NewYork-Presbyterian", /new\s?york[- ]presbyterian|\bnyp\b/i, "nyp.org"],
  ["Montefiore", /montefiore/i, "montefiore.org"],
  ["Mount Sinai", /mount sinai|mt\.? sinai/i, "mountsinai.org"],
  ["NYU Langone", /nyu langone/i, "nyulangone.org"],
  ["Westchester Medical Center (WMCHealth)", /wmchealth|westchester medical center/i, "wmchealth.org"],
  ["Nuvance Health", /nuvance/i, "nuvancehealth.org"],
  ["Garnet Health", /garnet health/i, "garnethealth.org"],
  ["Optum", /\boptum\b/i, "optum.com"],
  ["WestMed", /westmed/i, "westmedgroup.com"],
  ["Stony Brook Medicine", /stony brook medicine/i, "stonybrookmedicine.edu"],
];

// National chains: their name on their own site is enough.
const CHAINS = [
  ["LifeStance Health", /lifestance/i],
  ["Thriveworks", /thriveworks/i],
  ["Mindpath Health", /mindpath/i],
  ["Refresh Mental Health", /refresh mental health/i],
  ["Talkspace", /talkspace/i],
  ["Brightside Health", /brightside health/i],
  ["Charlie Health", /charlie health/i],
];

// The PRACTICE as subject: "we are part of", "is now a division of". Not "is a staff
// member of" or "affiliated with", which is what a doctor's bio says about a
// hospital they work at, and both turned up as false alarms on the first run.
const OWNED = /\b(is|are|now|proudly|we're)\s+(now\s+)?(a\s+)?(proud\s+)?(part of|division of|owned by|operated by|subsidiary of|member of the)\b/i;

/**
 * The big organisation that owns this practice, or null.
 * `text` is visible page text, `site` the practice's own web address: a practice
 * page that lives ON northwell.edu is Northwell's. A link to it is not, because
 * a bio links to the hospital a doctor works at.
 */
export function ownerOf(text, site = "") {
  const t = String(text || "");
  for (const [name, re] of CHAINS) if (re.test(t)) return { owner: name, why: "chain name on its own site" };
  for (const [name, re, domain] of SYSTEMS) {
    const host = String(site).replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    if (host && host.endsWith(domain)) return { owner: name, why: `the practice page is on ${domain}` };
    for (const m of t.matchAll(new RegExp(re.source, "gi"))) {
      const near = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20);
      if (OWNED.test(near)) return { owner: name, why: `"${near.trim().replace(/\s+/g, " ")}"` };
      if (/(©|&copy;|copyright)\s*(\d{4})?/i.test(t.slice(Math.max(0, m.index - 40), m.index))) {
        return { owner: name, why: "copyright line names it" };
      }
    }
  }
  return null;
}

// ponytail: three bands by named clinicians. A site that names nobody gives 0 and
// no band, which is "unknown", never "solo". Tune the cut-offs here, nowhere else.
export const BANDS = [
  // The studio's offers, decided 2026-10-18.
  { max: 2, band: "solo or small", offer: "Get Found package ($1,500 one time)" },
  { max: 9, band: "group", offer: "Practice Content Engine ($3,000/mo)" },
  { max: Infinity, band: "large group", offer: "Practice Content Engine ($3,000/mo; $5,000 once client proof exists)" },
];

export function sizeOf(clinicians) {
  const n = Number(clinicians) || 0;
  if (!n) return null;
  return { clinicians: n, ...BANDS.find((b) => n <= b.max) };
}

/** Same-site links that probably list the clinicians. */
export const TEAM_PATH = /\/(our-)?(team|providers?|clinicians?|staff|therapists?|psychiatrists?|people|meet|about-us|who-we-are)\b/i;
