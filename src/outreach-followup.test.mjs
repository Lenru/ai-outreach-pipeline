import { test } from "node:test";
import assert from "node:assert/strict";
import { planFollowup, nyDate } from "./outreach-followup.mjs";
import { textGate, withFooter } from "./outreach-gates.mjs";

const p = { stage: "contacted", next_action_due: "2026-10-21", official_name: "Jane Roe, LCSW",
  website: "janeroetherapy.example", email: "jane@janeroetherapy.example",
  evidence: [{ proven: true, claim: "Email jane@janeroetherapy.example on the contact page", source: "https://janeroetherapy.example/contact" }] };
const sent = (tag) => ({ body: `SENT 2026-10-21 from x\nTo: a\nSubject: Re: social media for the practice\nTag: ${tag}\n\nHi` });

test("nothing before the due date", () => assert.equal(planFollowup(p, [], "2026-10-20").skip, "not due yet"));
test("first, then last, then stop", () => {
  const a = planFollowup(p, [], "2026-10-21").draft;
  assert.equal(a.tag, "followup-1");
  assert.equal(a.due, "2026-10-28");
  assert.match(a.text, /^Hi Jane,/);
  assert.match(a.text, /janeroetherapy\.example and your Google listing/);
  const b = planFollowup(p, [sent("followup-1")], "2026-10-28").draft;
  assert.equal(b.tag, "followup-2");
  assert.equal(b.due, null);
  assert.equal(planFollowup(p, [sent("followup-1"), sent("followup-2")], "2026-11-04").skip, "both follow-ups already sent");
});
test("any reply holds it", () => {
  assert.match(planFollowup(p, [{ body: "REPLY from jane@janeroetherapy.example\nSounds good" }], "2026-10-21").skip, /replied/);
});
test("do not contact holds it", () => assert.equal(planFollowup({ ...p, do_not_contact: true }, [], "2026-10-21").skip, "do not contact"));
test("both drafts pass the send gates", () => {
  for (const touches of [[], [sent("followup-1")]]) {
    const d = planFollowup(p, touches, "2026-10-28").draft;
    const body = withFooter(d.text, "1 Main St, Kingston, NY 12401").text;
    assert.deepEqual(textGate({ subject: d.subject, body, prospect: p, email: d.to }), []);
  }
});
test("ny date is a date", () => assert.match(nyDate(), /^\d{4}-\d{2}-\d{2}$/));
test("a bounce holds it", () => assert.match(planFollowup(p, [{ body: "Delivery Status Notification: address not found" }], "2026-10-21").skip, /bounced/));
test("quotes the first email, old footer cut, new footer at the bottom, gates pass", () => {
  const first = { body: `SENT 2026-10-15 from Noah Watson <noah@watsonsmedia.com>\nTo: jane@janeroetherapy.example\nSubject: social media for the practice\nResend id: abc\n\nHi Jane,\n\nI had a look at janeroetherapy.example.\n\nNoah Watson\nWatson's Media\n\nReply "stop" and I won't email you again.\n1 Main St, Kingston, NY 12401` };
  const d = planFollowup(p, [first], "2026-10-21").draft;
  assert.equal(d.subject, "Following up");
  assert.match(d.text, /On Oct 15, Noah Watson wrote:\n> Hi Jane,\n>\n> I had a look at janeroetherapy\.example\./);
  assert.doesNotMatch(d.text, /stop/);
  const body = withFooter(d.text, "1 Main St, Kingston, NY 12401").text;
  assert.match(body, /> Watson's Media\n\nReply "stop"/);
  assert.deepEqual(textGate({ subject: d.subject, body, prospect: p, email: d.to }), []);
});
test("a hand-logged first email means no quote", () => {
  assert.doesNotMatch(planFollowup(p, [{ body: "Cold email sent to jane@janeroetherapy.example from noah@watsonsmedia.com." }], "2026-10-21").draft.text, /wrote:/);
});

test("a first email whose claim no longer holds is not quoted again", () => {
  const cold = { body: "SENT 2026-10-14 from x\nTo: a\nSubject: social media for the practice\n\nHi Jane,\n\nthe only social account linked from the site is a LinkedIn page, so...\n\nNoah" };
  const two = { ...p, evidence: [...p.evidence, { proven: true, claim: "Links one linkedin account." }, { proven: true, claim: "Links one instagram account." }] };
  const one = { ...p, evidence: [...p.evidence, { proven: true, claim: "Links one linkedin account." }] };
  assert.doesNotMatch(planFollowup(two, [cold], "2026-10-21").draft.text, /wrote:/);
  assert.match(planFollowup(one, [cold], "2026-10-21").draft.text, /wrote:/);
});
test("a follow-up never quotes a Google rank, fresh or not (Noah, 2026-11-02: cut it)", () => {
  const row = { proven: true, checked_on: "2026-10-27", source: "https://www.google.com/maps/search/x",
    claim: 'Ranks 4 on Google Maps for "therapist Kingston NY" with 2 reviews; above it are two local practices with 40 and 31.' };
  const q = { ...p, evidence: [...p.evidence, row] };
  const cold = { body: 'SENT 2026-10-27 from x\nTo: a\nSubject: Kingston on Google Maps\n\nHi Jane,\n\nWhen I searched "therapist Kingston NY" on Google Maps on Tuesday, you came up 4th.\n\nNoah' };
  const d = planFollowup(q, [cold], "2026-10-28").draft;
  assert.doesNotMatch(d.text, /came up|\b\d+(st|nd|rd|th)\b|wrote:/);
  assert.doesNotMatch(d.subject, /Maps/);
});
