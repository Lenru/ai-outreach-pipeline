// The last gate: re-open their site and confirm, right now, the one fact the email states.
//
// WHY. textGate checks the email against the evidence we stored, so a stored fact that was
// misread (Healthie read out of "healthier", 2026-11-02) or has gone stale (a Maps rank that
// moved from 4th to 3rd in two days) passes it. Noah: "people are not gonna keep reading if
// they're like, oh, this is not even correct." So each fact is checked again, live, from
// the source. If it can't be confirmed, for any reason including a timeout, it is not sent.

import { bookingOf } from "./prospect-recon.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Why the email must not go, checked live. Empty array means every stated fact still holds. `fetch` is injectable for the test. */
export async function liveFails(body, prospect, { fetch = globalThis.fetch } = {}) {
  const fails = [];
  let origin;
  try { origin = new URL(/^https?:/i.test(prospect.website) ? prospect.website : `https://${prospect.website}`).origin; }
  catch { return ["no readable website on the record, so nothing can be re-checked"]; }

  const get = async (url) => {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
      return { status: r.status, text: await r.text() };
    } catch { return { status: 0, text: "" }; }
  };

  const tool = body.match(/book with you through ([A-Za-z][\w/ .-]{2,20}?),/i)?.[1]
    || body.match(/you take bookings through ([A-Za-z][\w/ .-]{2,20}?)(?: on |[,.])/i)?.[1];
  if (tool) {
    // The pages recon read: the stored site, its homepage, and the page the evidence cites.
    const src = (prospect.evidence || []).find((e) => e.proven && e.claim.startsWith(`Takes bookings through ${tool}.`))?.source;
    const pages = [...new Set([prospect.website, `${origin}/`, src].filter(Boolean))];
    const html = (await Promise.all(pages.map((u) => get(/^https?:/i.test(u) ? u : `https://${u}`)))).map((r) => r.text).filter(Boolean).join("\n");
    if (!html) fails.push(`could not load ${origin} to confirm they book through ${tool}`);
    else if (!bookingOf(html).some((t) => t.toLowerCase() === tool.toLowerCase())) fails.push(`live check: no link to ${tool} on their site now`);
  }

  if (/there'?s no sitemap/i.test(body)) {
    for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
      const r = await get(origin + p);
      if (r.status === 0) fails.push(`could not load ${origin}${p} to confirm there is no sitemap`);
      else if (r.status === 200 && /<(urlset|sitemapindex)\b/i.test(r.text)) fails.push(`live check: ${origin}${p} is a sitemap`);
    }
  }

  if (/no robots\.txt/i.test(body) || /there'?s no sitemap/i.test(body)) {
    const r = await get(`${origin}/robots.txt`);
    if (r.status === 0) fails.push(`could not load ${origin}/robots.txt`);
    else if (r.status === 200 && !/<html/i.test(r.text)) {
      if (/no robots\.txt/i.test(body)) fails.push("live check: robots.txt exists now");
      if (/^\s*sitemap:/im.test(r.text)) fails.push("live check: robots.txt names a sitemap");
    }
  }

  const title = body.match(/page title just says "([^"]+)"/i)?.[1];
  if (title) {
    const r = await get(`${origin}/`);
    const now = decode(r.text.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "");
    if (!r.text) fails.push(`could not load ${origin}/ to confirm its page title`);
    else if (now !== title) fails.push(`live check: the page title is now "${now}", not "${title}"`);
  }

  // Noah cut the Maps email on 2026-11-02 ("cut it"): a rank moved 9th, 7th, 8th, 6th in one afternoon.
  if (/on Google Maps|you c[oa]me up \d+(?:st|nd|rd|th)|\branks? \d+/i.test(body)) fails.push("names a Google Maps rank, which Noah cut: it changes by the hour");

  return fails;
}
