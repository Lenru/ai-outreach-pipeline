// Put drafted emails in the approval queue, where Noah reads them before anything sends.
//
// Noah, 2026-10-18: "are the drafts in the hub?" (the CRM's web UI). They were not. outreach-draft.mjs
// and outreach-followup.mjs each wrote a JSON file here, so the only way he ever
// saw a draft was Claude pasting it into a chat, and Tuesday's follow-ups would
// have been drafted into a file nobody but Claude could open.
//
// THIS SCRIPT WRITES NO TEXT OF ITS OWN. It imports draftFor and planFollowup and
// queues exactly what they produce, so the queue shows the same words the sender
// would send. Two places generating cold-email copy is how a frame gets changed in
// one and not the other, which is the fault that started this whole workstream.
//
// Queued is not approved and approved is not sent. This only ever writes rows at
// status 'pending'; Noah decides (outreach-approve.mjs), and outreach-send.mjs --approved
// still runs all four gates on the exact bytes afterwards.
//
// Dry run unless --write.
//
//   node src/outreach-queue.mjs [--write] [--followups] [--limit=N]

import { openStore } from "./lib/store.mjs";
import { pathToFileURL } from "node:url";
import { draftFor } from "./outreach-draft.mjs";
import { planFollowup, nyDate } from "./outreach-followup.mjs";

/** Prospects worth drafting a FIRST email to: never contacted, reachable, not parked. */
export function coldCandidates(list) {
  return (list || []).filter(
    (p) => !p.do_not_contact && p.stage === "lead" && p.email && p.official_name,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const withFollowups = args.includes("--followups");
  const cap = Number(args.find((a) => a.startsWith("--limit="))?.slice(8)) || Infinity;

  const sb = openStore();
  const { data: list, error } = await sb.rpc("crm_list");
  if (error) throw new Error(`crm_list: ${error.message}`);

  const today = nyDate(); // UTC queued tomorrow's follow-ups at 10pm on 2026-10-26
  const queue = [];

  for (const p of coldCandidates(list).slice(0, cap)) {
    let d;
    try { d = draftFor(p, {}); } catch { continue; }
    // No draft means the evidence does not support a specific sentence about
    // them. That is the drafter refusing, and it is not an error to report.
    if (!d?.text) continue;
    queue.push({
      prospect_id: p.id, kind: "cold", to_email: p.email,
      subject: d.subject, body: d.text, due: d.due || null, _name: p.name, _angle: d.angle,
    });
  }

  if (withFollowups) {
    for (const p of (list || []).filter((x) => !x.do_not_contact && x.stage !== "lead")) {
      const { data: rec } = await sb.rpc("crm_get", { p_id: p.id });
      let plan;
      try { plan = planFollowup(p, rec?.touches || [], today); } catch { continue; }
      if (!plan?.draft) continue;
      queue.push({
        prospect_id: p.id, kind: "followup", tag: plan.draft.tag, to_email: plan.draft.to,
        subject: plan.draft.subject, body: plan.draft.text, due: plan.draft.due || null, _name: p.name,
      });
    }
  }

  console.log(`${queue.length} draft(s) to queue.\n`);
  for (const q of queue) {
    console.log(`${q.kind === "followup" ? `${q.tag}`.padEnd(12) : "cold".padEnd(12)} ${String(q._name).slice(0, 40).padEnd(42)} ${q.to_email}`);
  }

  if (!write) { console.log("\ndry run. pass --write to put these in the approval queue."); return; }

  let ok = 0;
  for (const q of queue) {
    const { _name, _angle, ...row } = q;
    const { error: e } = await sb.rpc("crm_draft_save", { p: row });
    if (e) { console.log(`  FAILED ${_name}: ${e.message}`); continue; }
    ok++;
    // How we'd help them goes on the profile, so a reply finds the plan already written.
    if (_angle) {
      const { error: ae } = await sb.rpc("crm_save", { p: { id: row.prospect_id, angle: _angle } });
      if (ae) console.log(`  angle not saved for ${_name}: ${ae.message}`);
    }
  }
  console.log(`\n${ok} draft(s) waiting for approval. Read them: node src/outreach-approve.mjs`);
  console.log("Nothing sends until each one is approved there.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
