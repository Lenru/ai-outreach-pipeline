import test from "node:test";
import assert from "node:assert/strict";
import { coldCandidates } from "./outreach-queue.mjs";

const p = (over) => ({
  id: "x", name: "A Practice", stage: "lead", email: "info@a.com",
  official_name: "Jane Doe", do_not_contact: false, ...over,
});

test("only never-contacted leads get a first email queued", () => {
  const rows = [
    p({ id: "lead" }),
    p({ id: "already", stage: "contacted" }),
    p({ id: "won", stage: "won" }),
  ];
  assert.deepEqual(coldCandidates(rows).map((r) => r.id), ["lead"]);
});

test("a parked prospect is never queued", () => {
  // do_not_contact is set on duplicates and on practices that share a website
  // with one already contacted. Queueing one would undo that decision.
  assert.deepEqual(coldCandidates([p({ do_not_contact: true })]), []);
});

test("no address and no named person both disqualify", () => {
  // Gate 3 refuses an email with no recipient, and refuses a body that does not
  // name the decision maker. Queueing either would put a draft in front of Noah
  // that could never be sent.
  assert.deepEqual(coldCandidates([p({ email: null })]), []);
  assert.deepEqual(coldCandidates([p({ official_name: null })]), []);
});

test("an empty or missing list is not an error", () => {
  assert.deepEqual(coldCandidates([]), []);
  assert.deepEqual(coldCandidates(null), []);
});
