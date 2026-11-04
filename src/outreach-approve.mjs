// The human step: read each queued email in full, then approve it by id.
//
// In production this is a page in the CRM's web UI. Approval is permission to
// send those exact words and nothing more: outreach-send.mjs --approved still
// runs all four gates on the bytes afterwards.
//
//   node src/outreach-approve.mjs                 # print every pending draft, whole
//   node src/outreach-approve.mjs --approve=3,5   # approve drafts 3 and 5

import { openStore } from "./lib/store.mjs";

const sb = openStore();
const ids = process.argv.find((a) => a.startsWith("--approve="))?.slice(10).split(",").map(Number) || [];

if (!ids.length) {
  const { data: pending, error } = await sb.rpc("crm_drafts", { p_status: "pending" });
  if (error) throw new Error(`crm_drafts: ${error.message}`);
  for (const d of pending) console.log(`\n=== draft ${d.id}  ${d.kind}${d.tag ? ` ${d.tag}` : ""}  -> ${d.to_email}\nSubject: ${d.subject}\n\n${d.body}`);
  console.log(`\n${pending.length} pending. Approve the ones you read with --approve=<id,id>.`);
} else {
  for (const id of ids) {
    const { error } = await sb.rpc("crm_draft_approve", { p_id: id });
    console.log(error ? `  draft ${id}: ${error.message}` : `  draft ${id} approved`);
  }
}
