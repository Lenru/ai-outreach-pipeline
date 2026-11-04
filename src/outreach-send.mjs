// Send outreach from noah@watsonsmedia.com and log it on the CRM record.
//
// Resend holds the verified domain, so a send can come from any address on
// watsonsmedia.com. This is the ONLY script that emails anyone.
//
// Every send writes a `kind: 'email'` touch carrying the FULL body, because the
// one thing that mattered after a bad email went out was being able to read
// exactly what the recipient got. It also moves a `lead` to `contacted` and
// sets a follow-up date, so nothing sits silently.
//
// DOUBLE-SEND GUARD: a prospect that already has an email touch with the same
// subject is skipped. Re-running this script must never mail someone twice.
//
//   node src/outreach-send.mjs <drafts.json | --approved> [--write] [--force]
//
// Dry run unless --write. SITE_FIXTURES=<dir> makes the live check read saved
// HTML from that folder instead of the network, for the example data.
//
// drafts.json: [{ "website": "example.com", "to": "a@b.com",
//                 "subject": "...", "text": "...", "due": "2026-10-21",
//                 "next_action": "Follow up if no reply" }]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { nyDate } from "./outreach-followup.mjs";
import { openStore } from "./lib/store.mjs";
import {
  DAILY_CAP, footer, remainingToday, sentToday, stopped, textGate, withFooter,
} from "./outreach-gates.mjs";
import { liveFails } from "./outreach-live.mjs";
import { fixtureFetch } from "./lib/fixture-fetch.mjs";

const FROM = "Noah Watson <noah@watsonsmedia.com>";

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The email as HTML, so WE decide the gap between paragraphs.
 *
 * A text-only send leaves that to the client. Gmail renders text/plain in its
 * own way and a blank line between paragraphs comes out as a full empty line,
 * which is a wider gap than anybody writing the email intended. Noah saw the
 * first batch after it had gone and said he would have changed it. So the send
 * is multipart: this HTML part controls the spacing, and the plain text stays
 * as the fallback for a client that will not render HTML.
 *
 * A single newline inside a paragraph is deliberate (the signature) and becomes
 * a <br>; a blank line separates paragraphs and becomes a new <p>.
 */
export function renderHtml(text) {
  const paras = String(text).trim().split(/\n\s*\n/);
  const body = paras
    .map((para, i) => {
      const inner = para.split("\n").map((l) => esc(l.trim())).join("<br>");
      const gap = i === paras.length - 1 ? "0" : "0 0 12px";
      return `<p style="margin:${gap}">${inner}</p>`;
    })
    .join("\n");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">\n${body}\n</div>`;
}

const bare = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const force = args.includes("--force");
  // --preview=noah@... sends the real thing to Noah instead of the prospect, so
  // the spacing and the wrap can be judged in a real inbox before it goes out.
  // It logs nothing and ignores the already-emailed guard, because a preview is
  // not a touch on the prospect.
  const preview = args.find((a) => a.startsWith("--preview="))?.slice(10) || null;
  // --approved sends what Noah approved in the queue, instead of a file.
  // It is the stricter path, not a shortcut: a draft reaches 'approved' only
  // because he read the whole body (outreach-approve.mjs), and all
  // four gates still run on the exact bytes afterwards. An approval is permission
  // to send words; it cannot prove the footer is there or the address came off
  // the practice's own site, which is what the gates are for.
  const fromQueue = args.includes("--approved");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path && !fromQueue) {
    console.error("usage: node src/outreach-send.mjs <drafts.json | --approved> [--write] [--force] [--preview=you@example.com]");
    process.exit(2);
  }
  const key = process.env.RESEND_API_KEY;
  if (write && !key) throw new Error("RESEND_API_KEY missing from the env file");

  async function send(to, subject, text) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html: renderHtml(text) }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body.id;
  }

  // GATE 1, before anything else: with no postal address there is no legal
  // send, so this is an abort rather than a per-email skip.
  const foot = footer(process.env.OUTREACH_POSTAL_ADDRESS);
  if (foot.error) {
    console.error(`BLOCKED, nothing sent: ${foot.error}`);
    console.error("Set OUTREACH_POSTAL_ADDRESS in the environment. Ask Noah for it; never invent one.");
    process.exit(3);
  }

  const sb = openStore();
  const siteFetch = process.env.SITE_FIXTURES ? fixtureFetch(process.env.SITE_FIXTURES) : globalThis.fetch;

  // Read AFTER gate 1, so a missing postal address stops the run before anything
  // is pulled out of the queue.
  let drafts;
  if (fromQueue) {
    const { data: queued, error: qe } = await sb.rpc("crm_drafts", { p_status: "approved" });
    if (qe) throw new Error(`crm_drafts: ${qe.message}`);
    drafts = (queued || []).map((d) => ({
      website: d.website, to: d.to_email, subject: d.subject, text: d.body,
      due: d.due, tag: d.tag || undefined, next_action: "Follow up if no reply",
      _draftId: d.id,
    }));
    console.log(`${drafts.length} approved in the queue.
`);
  } else {
    drafts = JSON.parse(readFileSync(path, "utf8"));
    // A file send must close the same email's queued copy too, or it sits "pending"
    // in the queue after it went (4 did, 2026-10-20).
    const { data: pending } = await sb.rpc("crm_drafts", { p_status: "pending" });
    const queuedId = new Map((pending || []).map((q) => [`${q.to_email}|${q.subject}`, q.id]));
    for (const d of drafts) d._draftId ??= queuedId.get(`${d.to}|${d.subject}`);
  }

  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);
  const bySite = new Map();
  const sharedSite = new Set();
  for (const p of list || []) {
    if (bySite.has(bare(p.website))) sharedSite.add(bare(p.website));
    bySite.set(bare(p.website), p);
  }

  // A preview goes to Noah, so gates 2 and 4 do not apply (he has not asked to
  // stop and he is not the domain's reputation risk). Gates 1 and 3 DO run, and
  // block, because the whole point of a preview is to read what would really go
  // out: footer included, claims checked.
  if (preview) {
    let bad = 0;
    for (const d of drafts) {
      const p = bySite.get(bare(d.website));
      if (!p) { console.log(`SKIP  no prospect for ${d.website}`); continue; }
      const withFoot = withFooter(d.text, process.env.OUTREACH_POSTAL_ADDRESS);
      if (withFoot.error) { console.log(`BLOCK ${p.name}: ${withFoot.error}`); bad++; continue; }
      const fails = textGate({ subject: d.subject, body: withFoot.text, prospect: p, email: d.to });
      // Re-open their site: the evidence can be hours old (two "Healthie" emails, 2026-11-02).
      if (!fails.length) fails.push(...await liveFails(withFoot.text, p, { fetch: siteFetch }));
      if (fails.length) {
        console.log(`BLOCK ${p.name} -> ${d.to}`);
        for (const f of fails) console.log(`        ${f}`);
        bad++;
        continue;
      }
      if (!write) { console.log(`would preview ${d.to} -> ${preview}  [gates 1 and 3 pass]`); continue; }
      const id = await send(preview, `[preview to ${d.to}] ${d.subject}`, withFoot.text);
      console.log(`PREVIEW  ${d.to} -> ${preview}  ${id}`);
    }
    console.log(`\n${bad} blocked by a gate. Nothing was logged and no prospect was emailed.`);
    if (!write) console.log("dry run. pass --write to send the previews.");
    return;
  }

  // New York date: UTC is tomorrow every evening, which mislabelled 6 sends on 2026-10-26.
  const today = nyDate();

  // GATE 4: today's sends across EVERY prospect, so the cap holds across runs
  // and not just within one. Counted from the CRM, which is the only thing that
  // survives a crash or a second terminal.
  const everyTouch = [];
  for (const p of list || []) {
    const { data: rec } = await sb.rpc("crm_get", { p_id: p.id });
    everyTouch.push(...(rec?.touches || []).map((t) => ({ ...t, _pid: p.id })));
  }
  const already = sentToday(everyTouch, today);
  const askedCap = Number(args.find((a) => a.startsWith("--cap="))?.slice(6));
  let left = remainingToday(already, Number.isFinite(askedCap) ? askedCap : DAILY_CAP);
  console.log(`${already} sent today, ${left} left of a ${DAILY_CAP}-a-day cap on a domain that is new to sending.\n`);

  let sent = 0, skipped = 0, blocked = 0;

  for (const d of drafts) {
    const p = bySite.get(bare(d.website));
    if (!p) { console.log(`SKIP  no prospect for ${d.website}`); skipped++; continue; }
    // Two records on one website (a group practice, a duplicate) means the wrong
    // record's touches could be checked for a stop. Refuse rather than guess.
    if (sharedSite.has(bare(d.website))) {
      console.log(`SKIP  ${d.website} belongs to more than one prospect; merge them first`); skipped++; continue;
    }

    const touches = everyTouch.filter((t) => t._pid === p.id);

    // GATE 2, at SEND time: a draft written on Monday can be sent on Friday,
    // after they replied asking to stop.
    const halt = stopped(p, touches, d.to);
    if (halt) { console.log(`STOP  ${p.name}: ${halt.stop}`); skipped++; continue; }
    // A follow-up drafted at 9am must not chase someone who replied at 10.
    if (d.tag && touches.some((t) => /^REPLY from/i.test(String(t.body || "").trim()))) {
      console.log(`STOP  ${p.name}: they replied since this follow-up was drafted`); skipped++; continue;
    }

    if (!force) {
      // Follow-ups share one "Re:" subject, so they are told apart by their tag (outreach-followup.mjs).
      const key = d.tag ? `Tag: ${d.tag}` : `Subject: ${d.subject}`;
      const dup = touches.some((t) => t.kind === "email" && t.body.includes(key));
      if (dup) { console.log(`SKIP  ${p.name}: already emailed "${d.tag || d.subject}"`); skipped++; continue; }
    }

    // GATE 1 applied, then GATE 3 on the EXACT bytes that will be sent.
    const withFoot = withFooter(d.text, process.env.OUTREACH_POSTAL_ADDRESS);
    if (withFoot.error) { console.log(`BLOCK ${p.name}: ${withFoot.error}`); blocked++; continue; }
    const finalText = withFoot.text;
    const fails = textGate({ subject: d.subject, body: finalText, prospect: p, email: d.to });
    // Before the cap check, so a blocked email never spends a send slot.
    if (!fails.length) fails.push(...await liveFails(finalText, p, { fetch: siteFetch }));
    if (fails.length) {
      console.log(`BLOCK ${p.name} -> ${d.to}`);
      for (const f of fails) console.log(`        ${f}`);
      blocked++;
      continue;
    }

    if (left <= 0) { console.log(`HOLD  ${p.name}: the ${DAILY_CAP}-a-day cap is reached. Run again tomorrow.`); skipped++; continue; }
    if (!write) { console.log(`would send to ${d.to}  (${p.name})  [all four gates pass]`); left--; continue; }

    const id = await send(d.to, d.subject, finalText);
    left--;
    const body = `SENT ${today} from ${FROM}\nTo: ${d.to}\nSubject: ${d.subject}\n${d.tag ? `Tag: ${d.tag}\n` : ""}Resend id: ${id}\n\n${finalText}`;
    const { error: e1 } = await sb.rpc("crm_touch", { p_id: p.id, p_kind: "email", p_body: body });
    // A cold email from the queue carries no due date; without one its follow-up never came up (2026-10-26).
    const due = d.due || (d.tag ? null : new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10));
    const save = { id: p.id, next_action: d.next_action || "Follow up if no reply", next_action_due: due };
    if (p.stage === "lead") save.stage = "contacted";
    const { error: e2 } = await sb.rpc("crm_save", { p: save });
    // Only after Resend accepted it. A draft marked sent that never went would
    // be invisible in the queue and unsendable, which is worse than a retry.
    if (d._draftId) {
      const { error: e3 } = await sb.rpc("crm_draft_sent", { p_id: d._draftId });
      if (e3) console.log(`        queue not updated: ${e3.message}`);
    }
    console.log(`SENT  ${p.name} -> ${d.to}  ${id}${e1 || e2 ? `  (LOGGING FAILED: ${e1?.message || e2?.message})` : ""}`);
    sent++;
  }

  console.log(write
    ? `\n${sent} sent, ${skipped} skipped, ${blocked} blocked by a gate.`
    : `\ndry run. ${sent + (drafts.length - skipped - blocked)} would send, ${skipped} skipped, ${blocked} blocked by a gate. pass --write.`);
}

// Only when run directly, so renderHtml can be imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
