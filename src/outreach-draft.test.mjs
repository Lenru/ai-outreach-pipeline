import test from "node:test";
import assert from "node:assert/strict";
import { draftFor, greet, titlesOf } from "./outreach-draft.mjs";
import { textGate } from "./outreach-gates.mjs";

const ev = (claim, p = true) => ({ claim, source: "https://x.com", checked_on: "2026-10-15", proven: p });
const BOOKS = ev("Takes bookings through IntakeQ.");
const TODAY = new Date("2026-11-02");
const rank = (n, on = "2026-11-01") => ({ ...ev(`Ranks ${n} on Google Maps for "therapist Pleasantville NY" with 6 reviews; the top three are three local practices with 5, 34 and 2.`), checked_on: on });
const SEO = [ev("No sitemap.xml or sitemap_index.xml, and robots.txt names none."), ev("No robots.txt (404)."), ev('Homepage title is only "WELCOME TO OAKVIEW!".')];

const base = {
  website: "example.com", email: "a@example.com", stage: "lead",
  official_name: "Alex Morgan, MD", do_not_contact: false, evidence: [],
};

test("a doctorate is addressed by title, everything else by first name", () => {
  assert.equal(greet("Alex Morgan, MD"), "Dr. Morgan");
  assert.equal(greet("Gordon Pike, PH.D"), "Dr. Pike");
  assert.equal(greet("Elena Marsh, Ph.D"), "Dr. Marsh");
  // "Dr Reyes" to a marriage therapist is worse than being too casual.
  assert.equal(greet("Marco Reyes, LMFT"), "Marco");
  assert.equal(greet("Dana Fowler, LCSW-R"), "Dana");
  assert.equal(greet(null), null);
});

test("an honorific on the front counts as much as letters on the end", () => {
  // Their homepage is signed "-Dr. Rowan Hale" and gives no credential to read.
  // Inventing a PhD to make the greeting work would be a made-up fact.
  assert.equal(greet("Dr. Rowan Hale"), "Dr. Hale");
  assert.equal(greet("Dr Rowan Hale"), "Dr. Hale");
  assert.equal(greet("Professor Jane Doe"), "Dr. Doe");
  // And it must not eat a real first name that merely starts with those letters.
  assert.equal(greet("Drew Palmer, LCSW"), "Drew");
  assert.equal(greet("Profit Clinic Manager, LMHC"), "Profit");
});

test("an unproven claim can never reach the email", () => {
  const d = draftFor({ ...base, evidence: [ev("Takes bookings through IntakeQ.", false)] });
  assert.ok(d.skip, JSON.stringify(d));
});

test("a Maps rank is never the email, fresh or not (Noah, 2026-11-02: cut it)", () => {
  assert.match(draftFor({ ...base, evidence: [rank(6), BOOKS] }).text, /book with you through IntakeQ/);
  assert.doesNotMatch(draftFor({ ...base, evidence: [rank(6), BOOKS] }).text, /Google Maps|came up/);
  assert.match(draftFor({ ...base, evidence: [rank(6)] }).skip, /nothing true to say/);
});

test("missing site basics needs all three rows, and beats the booking email", () => {
  const d = draftFor({ ...base, evidence: [...SEO, BOOKS] });
  assert.match(d.text, /There's no sitemap, no robots\.txt, and the page title just says "WELCOME TO OAKVIEW!"\./);
  assert.match(draftFor({ ...base, evidence: [SEO[0], SEO[1], BOOKS] }).text, /IntakeQ/, "no title row, no SEO email");
});

test("the booking email asks how clients found them, then makes the offer", () => {
  const d = draftFor({ ...base, evidence: [BOOKS] });
  assert.match(d.text, /^Hi Dr\. Morgan,\n\nClients book with you through IntakeQ, but can you tell how each of them found you first\?/);
  assert.match(d.text, /I've got three things I'd set up first\. Reply and I'll send them over\./);
});

test("nothing true to say is a refusal", () => {
  // Social-gap lines are gone (Noah, 2026-11-02: "doesn't make a lot of sense").
  const d = draftFor({ ...base, evidence: [ev("No social account is linked anywhere on the site."), ev("6 clinicians named on the site: A; B.")] });
  assert.match(d.skip, /nothing true to say/);
  assert.match(draftFor({ ...base, website: null, evidence: [BOOKS] }).skip, /no website/);
});

test("every email shape passes gate 3 on its own evidence", () => {
  for (const evidence of [[...SEO], [BOOKS]]) {
    const d = draftFor({ ...base, evidence });
    // Only gate 3's claim checks matter here; footer, name and address have their own tests.
    const fails = textGate({ subject: d.subject, body: d.text, prospect: { ...base, evidence }, email: null })
      .filter((f) => !/opt-out|recipient|does not name/.test(f));
    assert.deepEqual(fails, [], d.text);
    assert.ok(!/[\u2014\u2013]/.test(d.text), "em-dash in a draft");
    assert.doesNotMatch(d.text, /Want me to\?|outside Chicago|followers/);
  }
});

test("a wrong booking tool or a wrong title is caught by the gate", () => {
  const d = draftFor({ ...base, evidence: [BOOKS] });
  assert.ok(textGate({ subject: "x", body: d.text.replace("IntakeQ", "Zocdoc"), prospect: { ...base, evidence: [BOOKS] }, email: null }).some((f) => /booking tool as "zocdoc"/.test(f)));
  const s = draftFor({ ...base, evidence: SEO });
  assert.ok(textGate({ subject: "x", body: s.text.replace("WELCOME TO OAKVIEW!", "Home"), prospect: { ...base, evidence: SEO }, email: null }).some((f) => /page title as "home"/.test(f)));
});

test("draftFor refuses the cases that must never be emailed", () => {
  const good = [BOOKS];
  assert.match(draftFor({ ...base, evidence: good, do_not_contact: true }).skip, /do_not_contact/);
  assert.match(draftFor({ ...base, evidence: good, email: null }).skip, /no email/);
  assert.match(draftFor({ ...base, evidence: good, channel: "in_person" }).skip, /in-person/);
  assert.match(draftFor({ ...base, evidence: good, stage: "contacted" }).skip, /already at stage/);
  assert.match(draftFor({ ...base, evidence: good, official_name: null }).skip, /no named decision maker/);
  assert.ok(!draftFor({ ...base, evidence: good }).skip);
});

test("the verified titles ride along on every draft, longest first", () => {
  const p = {
    ...base,
    evidence: [
      BOOKS,
      ev("Article published on the practice's own site, titled \"Short One Here\"."),
      ev("Article published on the practice's own site, titled \"A Considerably Longer Article Title\"."),
      ev("Article published on the practice's own site, titled \"Not Actually Verified\".", false),
    ],
  };
  assert.deepEqual(draftFor(p).titles, ["A Considerably Longer Article Title", "Short One Here"]);
  assert.deepEqual(titlesOf({ ...p, evidence: p.evidence.slice(3) }), []);
});

test("a billing inbox or a staff member gets no cold email", () => {
  const p = { stage: "lead", email: "billing@quietpractice.example", official_name: "Jo Lee, LCSW", website: "https://quietpractice.example" };
  assert.match(draftFor(p).skip, /billing/);
  assert.match(draftFor({ ...p, email: "jo@quietpractice.example", official_title: "Staff Clinician" }).skip, /staff/);
  assert.doesNotMatch(draftFor({ ...p, email: "jo@quietpractice.example", official_title: "Owner/Clinician" }).skip, /staff/);
});


test("every draft carries the plan for the profile, matching the email it came with", () => {
  const maps = draftFor({ ...base, evidence: [BOOKS] });
  assert.match(draftFor({ ...base, evidence: SEO }).angle, /no sitemap, no robots\.txt, and its page title is just "WELCOME TO OAKVIEW!"\. How we'd help/);
  assert.match(draftFor({ ...base, evidence: [BOOKS] }).angle, /^New clients book through IntakeQ, .* question to the IntakeQ intake/);
  assert.ok(!("help" in maps), "the note never rides into the email fields");
});
