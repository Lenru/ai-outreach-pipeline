import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_CAP, footer, remainingToday, sentToday, stopped, textGate, withFooter,
} from "./outreach-gates.mjs";

const ADDR = "Watson's Media, 12 Example Road, Anytown, NY 10000";
const ev = (claim, source = "https://theirsite.example", p = true) =>
  ({ claim, source, checked_on: "2026-10-15", proven: p });

const PROSPECT = {
  official_name: "Alex Morgan, MD",
  website: "theirsite.example",
  evidence: [
    ev("No social account is linked anywhere on the site."),
    ev("Publishes on the site: 14 article links on the index."),
    ev("Email info@theirsite.example is published on the practice's contact page.", "https://theirsite.example/contact"),
  ],
};

const BODY = `Hi Dr Morgan,

I had a look at theirsite.example. You're publishing on the site already, and there's no social account linked anywhere on it.

Noah Watson
Watson's Media

Reply "stop" and I won't email you again.
Watson's Media, 12 Example Road, Anytown, NY 10000`;

const ok = (over = {}) => textGate({ subject: "social media for the practice", body: BODY, prospect: PROSPECT, email: "info@theirsite.example", ...over });

// ------------------------------------------------------------ gate 1: footer

test("gate 1 blocks a send with no postal address configured", () => {
  assert.match(footer("").error, /not set/);
  assert.match(footer("   ").error, /not set/);
  assert.match(withFooter("hi", undefined).error, /not set/);
});

test("gate 1 blocks a placeholder address, which is worse than none", () => {
  assert.match(footer("123 Main St").error, /placeholder/i);
  assert.match(footer("TBD").error, /placeholder|postal address/i);
  assert.match(footer("Anytown, New York").error, /does not look like a postal address/);
});

test("gate 1 adds an opt-out line and the address, exactly once", () => {
  const first = withFooter("Body text.", ADDR);
  assert.match(first.text, /Reply "stop" and I won't email you again\./);
  assert.ok(first.text.includes(ADDR));
  // Running it twice must not stack two footers.
  const second = withFooter(first.text, ADDR);
  assert.equal(second.text, first.text);
});

test("gate 3 lets a body go without naming their website", () => {
  const body = `Hi Dr. Morgan,\n\nI haven't heard back, so I'll assume the timing isn't right.\n\nNoah\n\nReply "stop" and I won't email you again.\n${ADDR}`;
  assert.deepEqual(ok({ body }), []);
});

// --------------------------------------------------------- gate 2: stop list

test("gate 2 blocks anyone who replied asking to stop", () => {
  for (const words of ["Please stop emailing me", "unsubscribe", "Not interested, thanks", "take me off your list", "Do not contact me again"]) {
    const t = [{ kind: "email", body: `REPLY from them@x.com\nSubject: re\n${words}` }];
    assert.ok(stopped({}, t), words);
  }
});

test("gate 2 does NOT trip on the word stop in our own footer", () => {
  // Our sent copy contains "Reply \"stop\"...". Matching the wrong direction
  // would block every second send to the same person.
  const ours = [{ kind: "email", body: `SENT 2026-10-15 from Noah\nTo: a@b.com\n\n${BODY}` }];
  assert.equal(stopped({}, ours), null);
});

test("gate 2 blocks an address that bounced", () => {
  for (const b of [
    "Cold email to hello@x.com BOUNCED (address not found)",
    "REPLY from mailer-daemon@googlemail.com\nDelivery Status Notification (Failure)",
    "REPLY from postmaster@x.com\n550 user unknown",
  ]) {
    assert.match(stopped({}, [{ kind: "email", body: b }]).stop, /bounced|stop/i);
  }
});

test("gate 2 honours do_not_contact on the record", () => {
  assert.match(stopped({ do_not_contact: true }, []).stop, /do_not_contact/);
});

test("gate 2 lets a normal reply through, because interest is not a stop", () => {
  const t = [{ kind: "email", body: "REPLY from them@x.com\nSubject: re\nSounds good, can you send more detail?" }];
  assert.equal(stopped({}, t), null);
});

// -------------------------------------------------------- gate 3: final text

test("gate 3 passes a clean, fully evidenced email", () => {
  assert.deepEqual(ok(), []);
});

test("gate 3 blocks the exact failure that already went out", () => {
  // 2026-10-14: "You're already writing posts for the site" to a
  // practice with no blog.
  const noBlog = { ...PROSPECT, evidence: PROSPECT.evidence.filter((e) => !/^Publishes/.test(e.claim)) };
  const fails = ok({ prospect: noBlog });
  assert.ok(fails.some((f) => /publish/i.test(f) && /no proven evidence/i.test(f)), JSON.stringify(fails));
});

test("gate 3 blocks a claim whose evidence is present but UNPROVEN", () => {
  const unproven = {
    ...PROSPECT,
    evidence: [
      ev("No social account is linked anywhere on the site."),
      ev("Publishes on the site: 14 article links on the index.", "https://theirsite.example", false),
      ev("Email info@theirsite.example is published on the practice's contact page.", "https://theirsite.example/contact"),
    ],
  };
  assert.ok(ok({ prospect: unproven }).some((f) => /publish/i.test(f)), "an unproven row must not support a claim");
});

test("gate 3 blocks a figure that disagrees with the evidence", () => {
  const p = {
    ...PROSPECT,
    evidence: [...PROSPECT.evidence, ev("9 clinicians named on the site: A; B; C.")],
  };
  const body = BODY.replace("You're publishing on the site already", "12 clinicians with their own pages is a lot");
  assert.ok(textGate({ subject: "x", body, prospect: p, email: "info@theirsite.example" })
    .some((f) => /clinicians.*"12".*evidence says "9"/i.test(f)), "a wrong number must be caught");
});

test("gate 3 blocks an em-dash and curly quotes in the final text", () => {
  assert.ok(ok({ body: BODY.replace("already,", "already \u2014") }).some((f) => /em-dash/.test(f)));
  assert.ok(ok({ subject: "a \u2014 b" }).some((f) => /em-dash/.test(f)));
  assert.ok(ok({ body: BODY.replace('"stop"', "“stop”") }).some((f) => /curly quotes/.test(f)));
});

test("gate 3 blocks an address with no recorded source, which is the LLM lead-finder case", () => {
  const noSource = { ...PROSPECT, evidence: PROSPECT.evidence.filter((e) => !/^Email /.test(e.claim)) };
  assert.ok(ok({ prospect: noSource }).some((f) => /no proven evidence records where/.test(f)));
});

test("gate 3 blocks an address recorded from somewhere other than their own site", () => {
  const fromElsewhere = {
    ...PROSPECT,
    evidence: [
      ...PROSPECT.evidence.filter((e) => !/^Email /.test(e.claim)),
      ev("Email info@theirsite.example is published on the practice's contact page.", "https://npiprofile.com/npi/123"),
    ],
  };
  assert.ok(ok({ prospect: fromElsewhere }).some((f) => /was recorded from npiprofile\.com/.test(f)));
});

test("gate 3 blocks a body naming somebody else's website", () => {
  assert.ok(ok({ body: BODY.replace("theirsite.example", "someoneelse.com") })
    .some((f) => /someoneelse\.com.*neither their site nor ours/.test(f)));
});

test("gate 3 blocks an email that greets nobody and one that names nobody", () => {
  assert.ok(ok({ body: BODY.replace("Hi Dr Morgan,", "Hello,") }).some((f) => /does not name|greets nobody/.test(f)));
  assert.ok(ok({ prospect: { ...PROSPECT, official_name: null } }).some((f) => /no named decision maker/.test(f)));
});

test("gate 3 blocks a body whose footer went missing", () => {
  const stripped = BODY.split('Reply "stop"')[0].trim();
  assert.ok(textGate({ subject: "x", body: stripped, prospect: PROSPECT, email: "info@theirsite.example" })
    .some((f) => /no opt-out line/.test(f)));
});

// -------------------------------------------------------- gate 4: daily cap

test("gate 4 counts today's sends and ignores replies and older sends", () => {
  const touches = [
    { kind: "email", body: "SENT 2026-10-15 from Noah\nTo: a@b.com", at: "2026-10-15T10:00:00Z" },
    { kind: "email", body: "SENT 2026-10-15 from Noah\nTo: c@d.com", at: "2026-10-15T11:00:00Z" },
    { kind: "email", body: "REPLY from them@x.com\nhello", at: "2026-10-15T12:00:00Z" },
    { kind: "email", body: "SENT 2026-10-14 from Noah\nTo: e@f.com", at: "2026-10-14T10:00:00Z" },
    { kind: "note", body: "SENT looks like a send but is a note", at: "2026-10-15T10:00:00Z" },
  ];
  assert.equal(sentToday(touches, "2026-10-15"), 2);
});

test("gate 4 caps the day at 20 and cannot be raised by a flag", () => {
  assert.equal(DAILY_CAP, 20);
  assert.equal(remainingToday(0), 20);
  assert.equal(remainingToday(18), 2);
  assert.equal(remainingToday(20), 0);
  assert.equal(remainingToday(25), 0);
  // A flag may lower it.
  assert.equal(remainingToday(0, 5), 5);
  // It may not raise it, whatever is passed.
  assert.equal(remainingToday(0, 500), 20);
  assert.equal(remainingToday(0, Infinity), 20);
  assert.equal(remainingToday(0, NaN), 20);
});

test("gate 3 blocks a quoted article title the evidence does not record", () => {
  // The drafter may quote a piece of their writing. Without this check it could
  // quote anything, which is the same hole as the claim that started all this.
  const withArticle = {
    ...PROSPECT,
    evidence: [...PROSPECT.evidence, ev('Article published on the practice\'s own site, titled "Why Sleep Matters For Anxiety".')],
  };
  const good = BODY.replace(
    "You're publishing on the site already,",
    '"Why Sleep Matters For Anxiety" is the kind of thing people search for before they book,',
  );
  assert.deepEqual(textGate({ subject: "x", body: good, prospect: withArticle, email: "info@theirsite.example" }), []);

  // Same sentence, a title nobody recorded.
  const bad = BODY.replace(
    "You're publishing on the site already,",
    '"Ten Secrets Of Better Sleep" is the kind of thing people search for before they book,',
  );
  assert.ok(
    textGate({ subject: "x", body: bad, prospect: withArticle, email: "info@theirsite.example" })
      .some((f) => /quotes "Ten Secrets Of Better Sleep".*no proven evidence/.test(f)),
  );
});

test("gate 3 will not accept an article row that is merely present but unproven", () => {
  const unproven = {
    ...PROSPECT,
    evidence: [...PROSPECT.evidence, ev('Article published on the practice\'s own site, titled "Why Sleep Matters For Anxiety".', "https://theirsite.example", false)],
  };
  const body = BODY.replace(
    "You're publishing on the site already,",
    '"Why Sleep Matters For Anxiety" is the kind of thing people search for before they book,',
  );
  assert.ok(textGate({ subject: "x", body, prospect: unproven, email: "info@theirsite.example" }).some((f) => /quotes "Why Sleep/.test(f)));
});

test("a practice owned by a big system is never emailed", async () => {
  const { stopped } = await import("./outreach-gates.mjs");
  const p = { evidence: [{ proven: true, claim: "Owned by a large organisation: Northwell Health (links to northwell.edu). Do not email." }] };
  assert.match(stopped(p, []).stop, /Northwell/);
  assert.equal(stopped({ evidence: [{ ...p.evidence[0], proven: false }] }, []), null);
});

test("'the only social account' needs exactly one linked account, in the current wording", () => {
  const one = { ...PROSPECT, evidence: [PROSPECT.evidence[2], ev("Links one linkedin account.")] };
  const two = { ...one, evidence: [...one.evidence, ev("Links one instagram account.")] };
  const body = BODY.replace("there's no social account linked anywhere on it", "the only social account linked from the site is a LinkedIn page")
    .replace("You're publishing on the site already, and ", "");
  const gate = (prospect) => textGate({ subject: "x", body, prospect, email: "info@theirsite.example" });
  assert.deepEqual(gate(one), []);
  assert.ok(gate(two).some((f) => /evidence records 2/.test(f)), JSON.stringify(gate(two)));
  assert.ok(textGate({ subject: "x", body: body.replace("a LinkedIn page", "an Instagram account"), prospect: one, email: "info@theirsite.example" })
    .some((f) => /evidence says "linkedin"/.test(f)));
});

test("'publishing on <their domain>' is checked like 'publishing on the site'", () => {
  const p = { ...PROSPECT, evidence: [PROSPECT.evidence[0], PROSPECT.evidence[2]] };
  const body = BODY.replace("You're publishing on the site already", "You're publishing on theirsite.example already");
  assert.ok(textGate({ subject: "x", body, prospect: p, email: "info@theirsite.example" }).some((f) => /publish/.test(f)));
});

test("a booking tool named before 'on <domain>' is read as just the tool", () => {
  const p = { ...PROSPECT, evidence: [...PROSPECT.evidence, ev("Takes bookings through IntakeQ.")] };
  const body = BODY.replace("You're publishing on the site already, and ", "You take bookings through IntakeQ on theirsite.example, but ");
  assert.deepEqual(textGate({ subject: "x", body, prospect: p, email: "info@theirsite.example" }), []);
});

test("stopped: a bounce stops only the address it names", () => {
  const t = [{ kind: "email", body: "Cold email to hello@x.com BOUNCED (address not found). Resend to info@x.com." }];
  assert.equal(stopped({}, t, "info@x.com"), null);
  assert.match(stopped({}, t, "HELLO@x.com").stop, /bounced/);
  // No recipient known, or a bounce that names nobody: fail closed.
  assert.match(stopped({}, t).stop, /bounced/);
  assert.match(stopped({}, [{ kind: "email", body: "Mail delivery failed: mailer-daemon" }], "info@x.com").stop, /bounced/);
});

test("'You have N clinicians on <domain>' (the drafter's team line) is checked against the count", () => {
  const p = { ...PROSPECT, evidence: [...PROSPECT.evidence, ev("6 clinicians named on the site: A; B; C; D; E; F.")] };
  const line = (n) => BODY.replace("You're publishing on the site already", `You have ${n} clinicians on theirsite.example`);
  const gate = (n) => textGate({ subject: "x", body: line(n), prospect: p, email: "info@theirsite.example" });
  assert.ok(!gate(6).some((f) => /clinicians/.test(f)), JSON.stringify(gate(6)));
  assert.ok(gate(16).some((f) => /clinicians.*"16".*evidence says "6"/i.test(f)), JSON.stringify(gate(16)));
});
