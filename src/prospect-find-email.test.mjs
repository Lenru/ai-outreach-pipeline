import test from "node:test";
import assert from "node:assert/strict";
import {
  clean, deCf, emailsOn, pickEmail, registrable, sameDomain, scoreEmail, surnameOf,
} from "./prospect-find-email.mjs";

test("a filename shaped like an address is not an address", () => {
  // Every Squarespace and Wix theme ships logo@2x.png. It matches the email
  // regex exactly, and emailing it would be emailing nobody.
  assert.equal(clean("logo@2x.png"), null);
  assert.equal(clean("hero@3x.webp"), null);
  assert.equal(clean("sprite@2x.svg"), null);
  assert.equal(clean("info@drquill.example"), "info@drquill.example");
});

test("unattended mailboxes and tooling domains are refused", () => {
  assert.equal(clean("no-reply@drquill.example"), null);
  assert.equal(clean("postmaster@drquill.example"), null);
  assert.equal(clean("abc123@o4507.ingest.sentry.io"), null);
  assert.equal(clean("you@example.com"), null);
  assert.equal(clean("hello@yourdomain.com"), null);
});

test("an address is normalised the way a page writes it", () => {
  assert.equal(clean("  INFO@DrQuill.example  "), "info@drquill.example");
  assert.equal(clean("mailto:info@drquill.example?subject=Hi"), "info@drquill.example");
  assert.equal(clean("<info@drquill.example>"), "info@drquill.example");
  // A sentence ends; the full stop is not part of the address.
  assert.equal(clean("write to info@drquill.example."), null, "a whole sentence is not an address");
  assert.equal(clean("info@drquill.example."), "info@drquill.example");
});

test("Cloudflare's hidden address is decoded, not reported as absent", () => {
  // Cloudflare XORs each byte against the first. Built here the same way its
  // own script does, so the fixture cannot drift from the real format.
  const addr = "office@abc-psychology.example";
  const key = 0x2a;
  const hex = [key, ...[...addr].map((c) => c.charCodeAt(0) ^ key)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(deCf(hex), addr);
  assert.equal(deCf(""), "");
  assert.equal(deCf("2a"), "", "a blob with no payload decodes to nothing, not to a guess");

  const html = `<a href="/cdn-cgi/l/email-protection#${hex}">Email us</a>`;
  assert.deepEqual(
    emailsOn(html, "https://abc-psychology.example/contact").map((c) => c.email),
    [addr],
  );
});

test("only mailto and Cloudflare are read from raw HTML", () => {
  // A CSS at-rule and a script key must never be mistaken for an inbox, so the
  // text pass runs on stripped text and the raw pass is limited to real links.
  const html = `
    <style>@media (max-width: 40em) { .x { color: red } }</style>
    <script>Sentry.init({dsn:"https://abc@o1.ingest.sentry.io/2"})</script>
    <a href="mailto:office@elmpsychology.example">Email</a>
    <p>Billing questions: billing@elmpsychology.example</p>`;
  const got = emailsOn(html, "https://elmpsychology.example/contact");
  assert.deepEqual(got.map((c) => c.email).sort(), ["billing@elmpsychology.example", "office@elmpsychology.example"]);
  assert.equal(got.find((c) => c.email.startsWith("office")).how, "mailto");
  assert.equal(got.find((c) => c.email.startsWith("billing")).how, "text");
});

test("the registrable domain ignores www and subdomains", () => {
  assert.equal(registrable("www.drquill.example"), "drquill.example");
  assert.equal(registrable("https://mail.drquill.example/contact"), "drquill.example");
  assert.equal(registrable("calmmind.clinic"), "calmmind.clinic");
  assert.equal(registrable("drexample.care"), "drexample.care");
  assert.equal(registrable("practice.co.uk"), "practice.co.uk");
  assert.equal(registrable("mail.practice.co.uk"), "practice.co.uk");
  assert.equal(registrable(""), "");
});

test("same domain is what proves an address is theirs", () => {
  assert.ok(sameDomain("info@drquill.example", "www.drquill.example"));
  assert.ok(sameDomain("info@mail.drquill.example", "drquill.example"));
  assert.ok(!sameDomain("info@drquill.example", "drquinn.example"));
  assert.ok(!sameDomain("drquill@gmail.com", "drquill.example"));
  assert.ok(!sameDomain("", "drquill.example"));
});

test("an off-domain address never outranks the practice's own", () => {
  // The Quinn case: inquiries@drquinn.example was recorded from a page on
  // uptownpsychologist.com and has been unsendable ever since, because nobody can
  // say which site is theirs. A front-desk local part must not buy its way past
  // the domain check.
  const cands = [
    { email: "info@someoneelse.com", source: "https://drquinn.example/contact", how: "mailto" },
    { email: "drquinn@drquinn.example", source: "https://drquinn.example/contact", how: "text" },
  ];
  const best = pickEmail(cands, "drquinn.example", "RICHARD QUINN");
  assert.equal(best.email, "drquinn@drquinn.example");
  assert.ok(best.own);
});

test("the front desk beats the wrong door", () => {
  const cands = [
    { email: "billing@lvpa.example", source: "https://lvpa.example/contact", how: "mailto" },
    { email: "info@lvpa.example", source: "https://lvpa.example/contact", how: "text" },
  ];
  assert.equal(pickEmail(cands, "lvpa.example", null).email, "info@lvpa.example");
});

test("the registry's named decision maker breaks a tie", () => {
  const cands = [
    { email: "jsmith@maylinmd.example", source: "https://maylinmd.example/", how: "mailto" },
    { email: "mlin@maylinmd.example", source: "https://maylinmd.example/", how: "mailto" },
  ];
  assert.equal(pickEmail(cands, "maylinmd.example", "MAY LIN").email, "mlin@maylinmd.example");
  assert.equal(surnameOf("MAY LIN"), "lin");
  assert.equal(surnameOf("GORDON I. PIKE"), "pike", "a middle initial is not a surname");
  assert.equal(surnameOf(""), "");
});

test("a free mailbox is reported, never proven theirs", () => {
  const cands = [{ email: "ridgecounseling@gmail.com", source: "https://ridgenet.example/contact", how: "mailto" }];
  const best = pickEmail(cands, "ridgenet.example", null);
  assert.ok(best.free);
  assert.ok(!best.own, "a gmail address cannot be proved theirs by its domain");
});

test("nothing found returns nothing, not an empty address", () => {
  assert.equal(pickEmail([], "drquill.example", null), null);
  assert.equal(pickEmail(null, "drquill.example", null), null);
  assert.deepEqual(emailsOn("<p>Call us on 845 555 0100</p>", "https://x.com"), []);
});

test("a mailto scores above the same address in free text", () => {
  const site = "abc-psychology.example";
  const link = scoreEmail({ email: `info@${site}`, how: "mailto" }, site, null);
  const text = scoreEmail({ email: `info@${site}`, how: "text" }, site, null);
  assert.ok(link > text, "somebody linked it on purpose");
});
