// Prospect replies -> CRM. Google Apps Script, runs INSIDE the sender's Gmail.
//
// Install (once per mailbox):
//   1. script.google.com > New project, signed in as that mailbox.
//   2. Paste a copy with the placeholders below filled in. Keep the filled copy
//      out of every repo, because it carries the secret.
//   3. Run `install` once and click Allow. It adds a 15-minute trigger.
//
// CRM_URL is an HTTP endpoint in front of your CRM store that answers
// POST /rpc/prospect_senders and POST /rpc/prospect_reply (not included here:
// in production they are database functions). A reply lands as a touch whose
// body starts "REPLY from <addr>", which is what gate 2 reads.
//
// It asks the database who the prospects are, filters the inbox locally, and only
// sends mail FROM a prospect. Nothing else leaves Gmail. A logged thread gets the
// label "CRM" so Noah can see it was logged; the database dedupes on message id.

const CRM_URL = "__CRM_URL__";
const CRM_KEY = "__PUBLIC_KEY__"; // a public key: what it may do is limited by SECRET on each call
const SECRET = "__PROSPECT_REPLY_SECRET__";

function rpc_(fn, body) {
  const res = UrlFetchApp.fetch(CRM_URL + "/rpc/" + fn, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: CRM_KEY, Authorization: "Bearer " + CRM_KEY },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(fn + " " + res.getResponseCode() + " " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function checkReplies() {
  const watch = rpc_("prospect_senders", { p_secret: SECRET });
  const emails = new Set(watch.emails), domains = new Set(watch.domains);
  if (!emails.size && !domains.size) return;
  const label = GmailApp.getUserLabelByName("CRM") || GmailApp.createLabel("CRM");
  const me = Session.getActiveUser().getEmail();
  // No "-label:CRM" here: GmailApp.search drops a whole THREAD once any message in it
  // carries the label, so every later reply in that thread was never seen (Fred Dalton,
  // 20 Oct 2026). The database dedupes on message id, so re-reading a thread is harmless.
  const cutoff = Date.now() - 3 * 864e5;
  for (const thread of GmailApp.search("in:inbox newer_than:3d", 0, 100)) {
    let logged = false;
    for (const m of thread.getMessages()) {
      if (m.getDate().getTime() < cutoff) continue; // already seen on an earlier run
      const from = (m.getFrom().match(/<([^>]+)>/) || [, m.getFrom()])[1].trim().toLowerCase();
      if (!emails.has(from) && !domains.has(from.split("@")[1])) continue;
      // A From line is trivially forged, so check whether Gmail itself verified it as
      // sent by THAT domain: DMARC pass, or a DKIM signature from the From domain.
      // (Bare SPF is not enough: it can pass for the spoofer's own domain.)
      const auth = (m.getHeader("Authentication-Results") || "").toLowerCase();
      const dom = from.split("@")[1];
      // Unverified is LOGGED and marked, not dropped. Most small practices never set
      // up DMARC or their own DKIM, so dropping them lost real replies silently
      // (a small practice, 2026-10-16). A forged reply can only add a note Noah reads.
      const verified = /\bdmarc=pass\b/.test(auth) || auth.indexOf("dkim=pass header.i=@" + dom) !== -1;
      const mark = verified ? "" : "UNVERIFIED SENDER: their domain cannot prove it sent this, so check it is really them.\n\n";
      const r = rpc_("prospect_reply", {
        p_secret: SECRET, p_from: from, p_subject: m.getSubject(),
        p_snippet: (mark + m.getPlainBody().split(/\nOn .+wrote:/)[0]).slice(0, 1500),
        p_message_id: m.getId(), p_at: m.getDate().toISOString(), p_mailbox: me,
      });
      if (r === "logged" || r === "duplicate") logged = true;
    }
    if (logged) thread.addLabel(label);
  }
}

function install() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("checkReplies").timeBased().everyMinutes(15).create();
  checkReplies();
}
