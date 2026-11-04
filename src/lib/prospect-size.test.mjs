import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerOf, sizeOf } from "./prospect-size.mjs";

test("a bio mentioning a hospital is not ownership", () => {
  assert.equal(ownerOf("Dr Doe completed her residency at Mount Sinai and Montefiore."), null);
  // Both from the first live run (2026-10-16): bios, not owners.
  assert.equal(ownerOf("Dr. Smith is a staff member of the Westchester Medical Center."), null);
  assert.equal(ownerOf("psychiatry at Albert Einstein College of Medicine affiliated with Montefiore Medical Center"), null);
});

test("ownership wording, copyright line and domain link all count", () => {
  assert.equal(ownerOf("Lakeside Psychiatry is part of Northwell Health.").owner, "Northwell Health");
  assert.equal(ownerOf("© 2026 Montefiore Medical Center. All rights reserved").owner, "Montefiore");
  assert.equal(ownerOf("Contact us", "https://www.northwell.edu/find-care/psych").owner, "Northwell Health");
  assert.equal(ownerOf("Contact us", "northwellpsych-fan.com"), null);
});

test("a chain counts anywhere on its own site", () => {
  assert.equal(ownerOf("Book with LifeStance today").owner, "LifeStance Health");
});

test("size bands, and no names means unknown", () => {
  assert.equal(sizeOf(0), null);
  assert.equal(sizeOf(1).band, "solo or small");
  assert.equal(sizeOf(5).band, "group");
  assert.equal(sizeOf(14).band, "large group");
});
