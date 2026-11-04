// What is actually on a practice's website. Evidence, not a guess.
//
// WHY THIS EXISTS: a cold email said "you're already writing posts for the site"
// to a practice with no blog, because the check was /blog|news|insights/ matched
// anywhere in the homepage HTML. A nav word, a stylesheet name or a plugin slug
// passes that. So every claim here has to come from a FETCHED page:
//   - a blog exists only if a linked index page returns article links
//   - a social account exists only if the href has an account path on it
//   - a booking tool exists only if its vendor host or script is in the HTML
// Anything not proven is recorded with proven:false and must not be claimed in
// an email.
//
// The claims land on the prospect's evidence, each with the URL it came from and
// the date it was checked, so the CRM record shows where every fact came from.
// Dry run unless --write.
//
//   node src/prospect-recon.mjs sites.json [--write]

const SOCIAL = {
  "facebook.com": "facebook", "www.facebook.com": "facebook", "m.facebook.com": "facebook",
  "instagram.com": "instagram", "www.instagram.com": "instagram",
  "linkedin.com": "linkedin", "www.linkedin.com": "linkedin",
  "twitter.com": "twitter", "x.com": "twitter", "www.twitter.com": "twitter",
  "youtube.com": "youtube", "www.youtube.com": "youtube",
  "tiktok.com": "tiktok", "www.tiktok.com": "tiktok",
};

// A vendor host or script in the page body. "Schedule an appointment" is not a
// booking tool; it is usually "call us to schedule".
const BOOKING = {
  // Hosts only: a bare "healthie" matched "healthier" in body copy and put Healthie in two false drafts (2026-11-02).
  "gethealthie.com": "Healthie",
  "athenahealth.com": "athenahealth", "patientportal.athenahealth": "athenahealth",
  "janeapp.com": "Jane", "jane.app": "Jane",
  "simplepractice.com": "SimplePractice", "clientsecure.me": "SimplePractice",
  "calendly.com": "Calendly", "acuityscheduling.com": "Acuity",
  "zocdoc.com": "Zocdoc", "squareup.com/appointments": "Square",
  "intakeq.com": "IntakeQ", "therapyportal.com": "TherapyPortal",
  "charmhealth.com": "CharmHealth", "mdhq.com": "MDHQ",
  "luminello.com": "Luminello", "valant.io": "Valant",
  "osmind.org": "Osmind", "tebra.com": "Tebra", "patientpop": "Tebra/PatientPop",
};

const BLOGISH = /\/(blog|news|insights|articles?|posts?|resources|media|publications)(\/|$|\?)/i;

const strip = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z]+;/gi, " ")
  .replace(/\s+/g, " ").trim();

async function get(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, {
      redirect: "follow", signal: c.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36", accept: "text/html,*/*" },
    });
    return { status: r.status, url: r.url, html: r.status === 200 ? await r.text() : "" };
  } catch (e) {
    return { status: 0, url, html: "", err: String(e.message || e).slice(0, 80) };
  } finally { clearTimeout(t); }
}

// Some practice sites sit behind a bot challenge and answer 403 to any plain
// fetch. A text proxy still reads them, and a page read that way is still a
// page we read, so the evidence records the proxy as the source rather than
// pretending the site was unreadable. It returns markdown, so only the bare-URL
// and text claims survive: no <a> tags, so no blog crawl.
async function getVia(url) {
  const direct = await get(url);
  if (direct.html) return direct;
  const alt = await get(url.replace("https://", "https://www."));
  if (alt.html) return alt;
  const prox = await get(`https://r.jina.ai/${url}`);
  if (prox.html && !/Robot Challenge Screen|requiring CAPTCHA/i.test(prox.html)) {
    return { ...prox, url, via: prox.url, direct: direct.status };
  }
  return direct;
}

// A single video embedded on a page is not an account you can follow. Reporting
// one as "links a YouTube account" is the same kind of false claim as inferring
// a blog from a nav word, so the two are kept apart everywhere.
const ONE_VIDEO = /\/(watch\?|embed\/|shorts\/|v\/|videos\/\d|playlist\?)/i;

/** Social accounts and embedded videos from bare URLs. Works on markdown too. */
function socialsFromText(text) {
  const found = {}, videos = {};
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?(facebook|instagram|linkedin|twitter|x|youtube|youtu\.be|tiktok)\.com\/[^\s"'<>)\]]{2,70}/gi)) {
    const net = /^x$/i.test(m[1]) ? "twitter" : m[1].toLowerCase().replace("youtu.be", "youtube");
    if (/sharer|share\.php|intent\//i.test(m[0])) continue;
    if (ONE_VIDEO.test(m[0])) { if (!videos[net]) videos[net] = m[0]; continue; }
    if (!found[net]) found[net] = m[0];
  }
  return { socials: found, videos };
}

// The site builder's own accounts, tracking pixels and widgets: in the page, never the practice's.
const NOT_THEIRS = /\/(2008\/fbml|tr\b|tr\?|plugins|dialog|sharer|share|intent)|squarespace|wix|godaddy|wordpress|weebly|hubspot|elementor|yoast|wpengine/i;

/** Profile URLs anywhere in the raw page (script data included), for vetoing a "none linked" claim. */
export function hiddenSocials(html) {
  const out = new Set();
  const text = String(html || "").replace(/\\\//g, "/");
  for (const m of text.matchAll(/https?:\/\/(?:www\.|m\.)?(?:facebook|instagram|linkedin|twitter|x|tiktok|youtube)\.com\/[^\s"'<>)\]\\]{2,70}/gi)) {
    if (NOT_THEIRS.test(m[0]) || ONE_VIDEO.test(m[0])) continue;
    out.add(m[0]);
  }
  return [...out].slice(0, 5);
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    out.push({ href: u.href, host: u.hostname, path: u.pathname + u.search, text: strip(m[2]).slice(0, 90) });
  }
  return out;
}

function socialsOf(ls) {
  const found = {}, videos = {};
  for (const l of ls) {
    const net = SOCIAL[l.host];
    if (!net) continue;
    // A bare profile link has a path. Share/intent widgets and bare hosts do not count.
    const p = l.path.replace(/\/+$/, "");
    if (!p || p === "" || /sharer|share\.php|intent\/|\/plugins\//i.test(l.path)) continue;
    if (NOT_THEIRS.test(l.href)) continue; // "Made with Squarespace" links Squarespace's own accounts
    if (ONE_VIDEO.test(l.path)) { if (!videos[net]) videos[net] = l.href; continue; }
    if (!found[net]) found[net] = l.href;
  }
  return { socials: found, videos };
}

export function bookingOf(html) {
  const low = html.toLowerCase();
  const hit = new Set();
  for (const [k, v] of Object.entries(BOOKING)) if (low.includes(k)) hit.add(v);
  return [...hit];
}

/**
 * The newest full date among the stamps that is not in the future, or null.
 * Year-only matches never count: a footer copyright makes every site look current.
 */
export function newestStamp(stamps = [], on = new Date().toISOString().slice(0, 10)) {
  const limit = new Date(on).getTime() + 864e5; // an upcoming event is not a post
  let best = null;
  for (const s of stamps) {
    const m = String(s).match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    const d = m && new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (d && !isNaN(d) && d <= limit && (!best || d > best)) best = d;
  }
  return best;
}

/** Years and dates sitting in the page, so a stale blog shows as stale. */
function datesOf(text) {
  const years = [...text.matchAll(/\b(20[0-2]\d)\b/g)].map((m) => +m[1]).filter((y) => y >= 2005 && y <= 2027);
  const months = [...text.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(20[0-2]\d)\b/gi)].map((m) => m[0]);
  return { years: [...new Set(years)].sort(), stamps: [...new Set(months)].slice(0, 8) };
}

function namesOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'`-]+)\s*,?\s+(MD|DO|PhD|PsyD|LCSW|LMSW|LMHC|LMFT|PMHNP(?:-BC)?|NP|RN|MSW|MA|EdD)\b/g)) {
    out.add(`${m[1]}, ${m[2]}`);
  }
  return [...out].slice(0, 20);
}

import { ownerOf, sizeOf, TEAM_PATH } from "./lib/prospect-size.mjs";

async function recon(site) {
  const base = site.website.startsWith("http") ? site.website : `https://${site.website}`;
  const home = await getVia(base);
  const r = { name: site.name, url: base, status: home.status, err: home.err, via: home.via };
  if (!home.html) return r;
  if (home.via) {
    // Markdown from the proxy: no tags to parse, so claim only what text shows.
    const txt = strip(home.html);
    r.status = 200;
    r.title = (home.html.match(/^Title:\s*(.+)$/m)?.[1] || "").trim().slice(0, 120);
    r.h1 = [...home.html.matchAll(/^#{1,2}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 3);
    r.words = txt.split(" ").length;
    ({ socials: r.socials, videos: r.videos } = socialsFromText(home.html));
    r.booking = bookingOf(home.html);
    r.names = namesOf(txt);
    r.owner = ownerOf(txt, base);
    r.blog = null;
    r.blogLinks = [];
    r.homeText = txt.slice(0, 1400);
    return r;
  }

  const ls = links(home.html, home.url);
  const text = strip(home.html);
  r.title = (home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 120);
  r.h1 = [...home.html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 3);
  r.h2 = [...home.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 10);
  r.words = text.split(" ").length;
  ({ socials: r.socials, videos: r.videos } = socialsOf(ls));
  // A record can point at /contact-us, not the homepage (2026-11-02): read both.
  // And a builder can add its social icons by script, so they are never an <a> tag (River's
  // Squarespace Facebook icon). Those only veto "no social account"; they never become a claim.
  let raw = home.html;
  const origin = new URL(home.url).origin + "/";
  if (home.url.replace(/\/$/, "") !== origin.replace(/\/$/, "")) {
    const top = await get(origin);
    if (top.html) {
      raw += top.html;
      r.socials = { ...socialsOf(links(top.html, top.url)).socials, ...r.socials };
    }
  }
  // "Anywhere on the site" has to mean more than the homepage: one practice linked its Twitter
  // only from /about. About and contact pages are where practices put them.
  const bareHost = (h) => h.replace(/^www\./, "");
  const self = bareHost(new URL(home.url).hostname);
  // Linked from the nav, or at the usual paths (one practice's /about was linked from nowhere).
  // get() returns no html for a 404, so a guessed path that is not there costs one request.
  const linked = ls.filter((l) => bareHost(l.host) === self && /\/(about|contact)/i.test(l.path)).map((l) => l.href);
  const guessed = ["about", "about-us", "contact", "contact-us"].map((p) => new URL(`/${p}`, origin).href);
  const extra = [...new Set([...linked, ...guessed].map((u) => u.replace(/\/$/, "")))]
    .filter((u) => u !== home.url.replace(/\/$/, "")).slice(0, 5);
  for (const u of extra) {
    const pg = await get(u);
    if (!pg.html) continue;
    raw += pg.html;
    r.socials = { ...socialsOf(links(pg.html, pg.url)).socials, ...r.socials };
  }
  r.hiddenSocials = hiddenSocials(raw);
  r.booking = bookingOf(home.html);
  r.names = namesOf(text);
  r.nav = [...new Set(ls.filter((l) => l.host === new URL(home.url).hostname && l.text).map((l) => l.text))].slice(0, 28);
  r.homeText = text.slice(0, 1400);

  // Size and owner: the clinicians are usually on a team page, not the homepage.
  const self0 = new URL(home.url).hostname;
  const teamUrl = ls.find((l) => l.host === self0 && TEAM_PATH.test(l.path))?.href;
  let teamText = "";
  if (teamUrl) {
    const tp = await get(teamUrl);
    if (tp.html) teamText = strip(tp.html);
  }
  const teamNames = namesOf(teamText);
  if (teamNames.length > r.names.length) { r.names = teamNames; r.namesFrom = teamUrl; }
  r.owner = ownerOf(`${text} ${teamText}`, home.url);

  // Blog: a LINK to an index, then that index fetched and checked for articles.
  const cand = [...new Set(ls.filter((l) => l.host === new URL(home.url).hostname && BLOGISH.test(l.path)).map((l) => l.href))].slice(0, 3);
  r.blogLinks = cand;
  r.blog = null;
  for (const c of cand) {
    const page = await get(c);
    if (!page.html) continue;
    const pls = links(page.html, page.url);
    const self = new URL(page.url).hostname;
    const arts = [...new Map(pls
      .filter((l) => l.host === self && l.text && l.text.split(" ").length >= 3 && l.path !== new URL(page.url).pathname)
      .map((l) => [l.href, l.text])).entries()].slice(0, 14);
    const t = strip(page.html);
    if (arts.length >= 2 || /\b(read more|posted on|continue reading)\b/i.test(t)) {
      r.blog = { url: page.url, articles: arts.map(([, txt]) => txt), ...datesOf(t), words: t.split(" ").length };
      break;
    }
    r.blog = { url: page.url, articles: [], note: "page loads but no article links found", ...datesOf(t), words: t.split(" ").length };
  }
  return r;
}

/**
 * The recon turned into claims a human can check, each with its own URL.
 *
 * A NEGATIVE is proven too: a page that loaded and carried no social link
 * proves there is no social link on that page. A page that did not load proves
 * nothing, so a blocked site gets exactly one entry, proven:false, and no
 * email may be written from it.
 */
export function evidenceOf(r, on = new Date().toISOString().slice(0, 10)) {
  const at = (claim, source, proven) => ({ claim, source, checked_on: on, proven });
  if (!r.status || r.status !== 200) {
    return [at(`Site could not be read (${r.status ? `HTTP ${r.status}` : r.err || "no response"}). Nothing about this practice is verified.`, r.url, false)];
  }
  const ev = [];
  if (r.via) {
    ev.push(at(`Site answered ${r.direct || 403} to a direct request, so it was read through a text proxy. Link markup is lost, so whether it has a blog is NOT established.`, r.via, false));
  }

  if (r.via) {
    // fall through: no blog claim either way
  } else if (r.blog?.articles?.length) {
    // Proven only with a dated post in the last 12 months. On 2026-10-31, 3 of 14
    // cold drafts said "you publish" off 2016 pages and a 2024 blog.
    const newestAt = newestStamp(r.blog.stamps, on);
    const fresh = !!newestAt && new Date(on) - newestAt <= 365 * 864e5;
    const newest = newestAt ? `, newest ${newestAt.toISOString().slice(0, 10)}` : r.blog.years?.length ? `, years seen ${r.blog.years.join("/")}` : "";
    // The TITLES are kept, not just the count. An email that says "you publish
    // on the site" reads like a mail merge; one that names the piece reads like
    // somebody looked. The first good emails in this campaign quoted a title,
    // and the generated ones could not until this line kept them.
    const titles = r.blog.articles
      .map((t) => String(t).replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 14 && t.split(" ").length >= 3 && !/^(skip to|read more|home|contact|about|subscribe|request an|next|previous)\b/i.test(t))
      .slice(0, 5);
    ev.push(at(
      `Publishes on the site: ${r.blog.articles.length} article links on the index${newest}.`
        + (titles.length ? ` Titles include: ${titles.map((t) => `"${t}"`).join("; ")}.` : "")
        + (fresh ? "" : " Not claimable: no dated post in the last 12 months."),
      r.blog.url, fresh,
    ));
  } else if (r.blog) {
    ev.push(at(`A blog page exists but carries no articles (${r.blog.words} words, no article links).`, r.blog.url, true));
  } else if (!r.via) {
    ev.push(at("No blog or article index is linked from the site.", r.url, true));
  }

  const nets = Object.entries(r.socials || {});
  if (nets.length) for (const [net, href] of nets) ev.push(at(`Links one ${net} account.`, href, true));
  else if (r.hiddenSocials?.length) {
    ev.push(at(`No social link is visible, but the page data names ${r.hiddenSocials.join(", ")}. Not claimable either way.`, r.url, false));
  } else ev.push(at("No social account is linked anywhere on the site.", r.url, true));
  for (const [net, href] of Object.entries(r.videos || {})) {
    ev.push(at(`One ${net} video is embedded on the site. That is a video, not an account.`, href, true));
  }

  if (r.booking?.length) for (const v of r.booking) ev.push(at(`Takes bookings through ${v}.`, r.url, true));
  else ev.push(at("No online booking vendor appears in the page source.", r.url, true));

  if (r.names?.length) ev.push(at(`${r.names.length} clinicians named on the site: ${r.names.slice(0, 6).join("; ")}${r.names.length > 6 ? "; and more" : ""}.`, r.namesFrom || r.url, true));
  const size = sizeOf(r.names?.length);
  ev.push(size
    ? at(`Size: ${size.band} (${size.clinicians} clinicians named). Fits the ${size.offer}.`, r.namesFrom || r.url, true)
    : at("Size unknown: the site names no clinicians.", r.url, false));
  // Read by outreach-gates stopped(): a practice owned by a big system is never emailed.
  if (r.owner) ev.push(at(`Owned by a large organisation: ${r.owner.owner} (${r.owner.why}). Do not email.`, r.url, true));
  ev.push(at(`Homepage is ${r.words} words. Headline: "${(r.h1 || [])[0] || r.title || "none"}".`, r.url, true));
  return ev;
}

async function writeEvidence(rows) {
  const { openStore } = await import("./lib/store.mjs");
  const { merge } = await import("./lib/evidence.mjs");
  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  const bySite = new Map((list || []).map((p) => [String(p.website || "").replace(/^https?:\/\//, "").replace(/\/$/, ""), p]));
  for (const [site, evidence, clinicians] of rows) {
    const p = bySite.get(site.replace(/^https?:\/\//, "").replace(/\/$/, ""));
    if (!p) { console.log(`  no prospect with website ${site}, skipped`); continue; }
    // An unreadable site proves nothing, and merging it would drop the earlier
    // recon rows, including a big-system "Owned by" row that keeps them off the list.
    if (evidence.length === 1 && !evidence[0].proven && evidence[0].claim.startsWith("Site could not be read")) {
      console.log(`  ${site}: unreadable this run, kept the earlier evidence`); continue;
    }
    // MERGE, never assign. Assigning here wiped the decision maker, the
    // confirmed website and the proof of where each email came from, all
    // written by sibling scripts, with no error and no visible symptom beyond
    // gate 3 refusing to send again. See src/lib/evidence.mjs.
    const { error: e2 } = await sb.rpc("crm_save", {
      p: {
        id: p.id, evidence: merge(p.evidence, evidence, "recon"),
        // Only fills a blank. A number Noah typed by hand outranks a regex count.
        ...(p.est_clinicians == null && clinicians ? { est_clinicians: clinicians } : {}),
      },
    });
    console.log(`  ${e2 ? `FAILED ${p.name}: ${e2.message}` : `${p.name}: ${evidence.length} claims`}`);
  }
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const arg = args.find((a) => a !== "--write") || "";

/** No argument means every prospect in the CRM that has a website. */
async function sitesFromCrm() {
  const { openStore } = await import("./lib/store.mjs");
  const sb = openStore();
  const { data, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  return (data || []).filter((p) => p.website).map((p) => ({ name: p.name, website: p.website }));
}

// Run only as a script, so the test file can import evidenceOf.
if (process.argv[1]?.endsWith("prospect-recon.mjs")) {
  let SITES;
  if (!arg) SITES = await sitesFromCrm();
  else if (arg.trim().startsWith("[")) SITES = JSON.parse(arg);
  else SITES = JSON.parse((await import("node:fs")).readFileSync(arg, "utf8"));

  const out = [];
  for (const s of SITES) {
    const r = await recon(s);
    r.evidence = evidenceOf(r);
    out.push(r);
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  for (const r of out) {
    console.log(`\n${r.name}  (${r.status})`);
    for (const e of r.evidence) console.log(`  [${e.proven ? "proven" : " NOT  "}] ${e.claim}\n            ${e.source}`);
  }
  if (write) {
    console.log("\nwriting to the prospect's evidence:");
    await writeEvidence(out.map((r) => [r.url, r.evidence, r.names?.length || 0]));
  } else {
    console.log("\ndry run. pass --write to save these onto the CRM records.");
  }
}
