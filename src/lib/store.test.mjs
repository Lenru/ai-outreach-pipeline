import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.mjs";

const fresh = () => openStore(join(mkdtempSync(join(tmpdir(), "crm-")), "crm.json"));

test("a new store starts from the example data, and a save patches only what it names", async () => {
  const sb = fresh();
  const { data: list } = await sb.rpc("crm_list");
  assert.ok(list.length > 0);
  assert.ok(!("touches" in list[0]), "the list carries no touches; crm_get does");
  await sb.rpc("crm_save", { p: { id: list[0].id, next_action: "x" } });
  const { data: rec } = await sb.rpc("crm_get", { p_id: list[0].id });
  assert.equal(rec.next_action, "x");
  assert.equal(rec.name, list[0].name);
});

test("a save without an id is a new lead", async () => {
  const sb = fresh();
  const { data: id } = await sb.rpc("crm_save", { p: { name: "New Practice" } });
  const { data: rec } = await sb.rpc("crm_get", { p_id: id });
  assert.equal(rec.stage, "lead");
  assert.deepEqual(rec.evidence, []);
});

test("a draft goes pending, then approved, then sent, and never skips a step", async () => {
  const sb = fresh();
  const { data: list } = await sb.rpc("crm_list");
  const { data: id } = await sb.rpc("crm_draft_save", { p: { prospect_id: list[0].id, kind: "cold", status: "approved" } });
  assert.equal((await sb.rpc("crm_drafts", { p_status: "pending" })).data.length, 1, "a queued draft is pending whatever it asks for");
  assert.match((await sb.rpc("crm_draft_sent", { p_id: id })).error.message, /pending, not approved/);
  assert.equal((await sb.rpc("crm_draft_approve", { p_id: id })).error, null);
  const [approved] = (await sb.rpc("crm_drafts", { p_status: "approved" })).data;
  assert.equal(approved.website, list[0].website, "an approved draft carries its prospect's website for the sender");
  assert.equal((await sb.rpc("crm_draft_sent", { p_id: id })).error, null);
});

test("an unknown function is an error, not a silent empty result", async () => {
  assert.match((await fresh().rpc("crm_nope")).error.message, /unknown function/);
});
