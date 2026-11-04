import test from "node:test";
import assert from "node:assert/strict";
import { merge, tag } from "./evidence.mjs";

const row = (claim, by) => ({ claim, source: "https://x.com", checked_on: "2026-10-15", proven: true, ...(by ? { by } : {}) });

test("a script refreshes only its own rows", () => {
  // This is the bug: prospect-recon assigned the column instead of merging and
  // wiped the decision maker, the website and the email source, with no error.
  const existing = [
    row("Decision maker is Alex Morgan, MD.", "officials"),
    row("Email info@x.com is published on the practice's own website.", "email-source"),
    row("No social account is linked anywhere on the site.", "recon"),
  ];
  const out = merge(existing, [row("Publishes on the site: 14 article links.")], "recon");
  const claims = out.map((r) => r.claim);
  assert.ok(claims.some((c) => /Decision maker/.test(c)), "the officials row must survive");
  assert.ok(claims.some((c) => /Email info@/.test(c)), "the email-source row must survive");
  assert.ok(!claims.some((c) => /No social account/.test(c)), "recon's own stale row should go");
  assert.ok(claims.some((c) => /Publishes on the site/.test(c)));
  assert.equal(out.length, 3);
});

test("rows that predate tagging are always kept", () => {
  const out = merge([row("An old untagged finding.")], [row("new")], "recon");
  assert.equal(out.length, 2);
  assert.ok(out.some((r) => r.claim === "An old untagged finding."));
});

test("merge stamps the fresh rows so the next run can find them", () => {
  const out = merge([], [row("a"), row("b")], "enrich");
  assert.ok(out.every((r) => r.by === "enrich"), JSON.stringify(out));
});

test("a missing or odd existing value is treated as empty, never thrown on", () => {
  assert.equal(merge(null, [row("a")], "x").length, 1);
  assert.equal(merge(undefined, [], "x").length, 0);
  assert.equal(merge("not an array", [row("a")], "x").length, 1);
  assert.deepEqual(tag(null, "x"), []);
});
