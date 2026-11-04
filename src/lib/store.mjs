// The CRM, as one JSON file.
//
// In production these calls are database functions (crm_list, crm_save, ...)
// behind a hub where drafts are read and approved. Every script reaches the
// CRM only through `rpc(name, args)`, so this file is the whole seam: swap it
// for a real database client and nothing else changes.
//
// The file is CRM_FILE, or data/crm.json, seeded from example/crm.json the
// first time it is opened, so a --write never edits the example.
//
// shortcut: whole-file read and rewrite on every write, no locking. Fine for one
// operator and a few hundred prospects; two terminals writing at once can lose
// a write, so use a real database before running anything concurrently.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const READS = new Set(["crm_list", "crm_get", "crm_drafts"]);

export function openStore(file = process.env.CRM_FILE || resolve(ROOT, "data/crm.json")) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, readFileSync(resolve(ROOT, "example/crm.json")));
  }
  const load = () => JSON.parse(readFileSync(file, "utf8"));
  const save = (db) => writeFileSync(file, JSON.stringify(db, null, 1));
  const nextId = (rows) => rows.reduce((n, r) => Math.max(n, Number(r.id) || 0), 0) + 1;
  const strip = ({ touches, ...p }) => p;

  const fns = {
    crm_list: (db) => db.prospects.map(strip),
    crm_get: (db, { p_id }) => db.prospects.find((p) => p.id === p_id) ?? null,
    // Like the database function: a row with an id is patched, one without is a new prospect.
    crm_save: (db, { p }) => {
      if (p.id == null) {
        const row = { stage: "lead", evidence: [], touches: [], ...p, id: nextId(db.prospects) };
        db.prospects.push(row);
        return row.id;
      }
      const row = db.prospects.find((x) => x.id === p.id);
      if (!row) throw new Error(`no prospect ${p.id}`);
      Object.assign(row, p);
      return row.id;
    },
    crm_touch: (db, { p_id, p_kind, p_body }) => {
      const row = db.prospects.find((x) => x.id === p_id);
      if (!row) throw new Error(`no prospect ${p_id}`);
      (row.touches ||= []).push({ kind: p_kind, body: p_body, at: new Date().toISOString() });
      return true;
    },
    // The approval queue. A draft is only ever written as 'pending'; a person moves it to 'approved'.
    crm_drafts: (db, { p_status }) => (db.drafts || [])
      .filter((d) => d.status === p_status)
      .map((d) => ({ ...d, website: db.prospects.find((p) => p.id === d.prospect_id)?.website })),
    crm_draft_save: (db, { p }) => {
      const row = { ...p, id: nextId(db.drafts ||= []), status: "pending", created_at: new Date().toISOString() };
      db.drafts.push(row);
      return row.id;
    },
    crm_draft_approve: (db, { p_id }) => setStatus(db, p_id, "pending", "approved"),
    crm_draft_sent: (db, { p_id }) => setStatus(db, p_id, "approved", "sent"),
  };

  return {
    async rpc(name, args = {}) {
      const fn = fns[name];
      if (!fn) return { data: null, error: { message: `unknown function ${name}` } };
      try {
        const db = load();
        const data = fn(db, args);
        if (!READS.has(name)) save(db);
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}

function setStatus(db, id, from, to) {
  const d = (db.drafts || []).find((x) => x.id === id);
  if (!d) throw new Error(`no draft ${id}`);
  if (d.status !== from) throw new Error(`draft ${id} is ${d.status}, not ${from}`);
  d.status = to;
  return true;
}
