import test from "node:test";
import assert from "node:assert/strict";
import { distinctive, emailsFrom, hostMatchesName, phoneProof, pickResults, placeByPhone } from "./prospect-enrich.mjs";

test("the registry phone number is proof, however it is written", () => {
  assert.ok(phoneProof("<p>Call us at (914) 555-0123 today</p>", "914-555-0123"));
  assert.ok(phoneProof('<a href="tel:+19145550123">call</a>', "914-555-0123"));
  assert.ok(phoneProof("<p>914.555.0123</p>", "914-555-0123"));
});

test("a different phone number is not proof", () => {
  assert.equal(phoneProof("<title>Harbor Psychiatry</title><p>914-999-8888</p>", "914-555-0123"), null);
});

test("a matching NAME is never proof on its own", () => {
  // This is the bug this script was rewritten to remove. Guessing a domain and
  // matching the title resolved "WHITE PLAINS FAMILY THERAPY PLLC" to the City of
  // White Plains and called it proven. Only the phone counts now.
  assert.equal(phoneProof("<title>White Plains Family Therapy</title>", "914-555-0000"), null);
  assert.equal(phoneProof("<h1>Alex Morgan MD Psychiatry</h1>", "914-555-0177"), null);
});

test("a short or missing phone proves nothing", () => {
  assert.equal(phoneProof("<p>911</p>", "911"), null);
  assert.equal(phoneProof("<p>anything</p>", null), null);
});

test("directories and registry scrapers are not the practice's site", () => {
  const html = [
    "npiprofile.com/npi/1234567893",
    "www.medicarelist.com/mental-health/x",
    "guide.md/provider/x",
    "brightroom.example/",
    "www.psychologytoday.com/us/therapists/x",
    "www.facebook.com/somepractice",
    "realpractice.example/about",
  ].map((u) => `<a href="/l/?uddg=${encodeURIComponent(`https://${u}`)}">x</a>`).join("");
  assert.deepEqual(pickResults(html), ["https://brightroom.example/", "https://realpractice.example/about"]);
});

test("one result per host, so a directory cannot flood the list", () => {
  const html = ["https://realpractice.example/a", "https://realpractice.example/b", "https://other.com/c"]
    .map((u) => `<a href="?uddg=${encodeURIComponent(u)}">x</a>`).join("");
  assert.deepEqual(pickResults(html), ["https://realpractice.example/a", "https://other.com/c"]);
});

test("emails prefer the practice's own domain and an inbox name", () => {
  const html = `<a href="mailto:hello@wixsite.com">x</a>
    <a href="mailto:dr.smith@harborpsych.test">x</a>
    <a href="mailto:info@harborpsych.test">x</a>
    <a href="mailto:no-reply@harborpsych.test">x</a>`;
  const got = emailsFrom(html, "www.harborpsych.test");
  assert.equal(got[0], "info@harborpsych.test");
  assert.ok(got.includes("dr.smith@harborpsych.test"));
  assert.ok(!got.some((e) => e.includes("no-reply")), got.join(","));
});

test("an image filename is never an email", () => {
  assert.deepEqual(emailsFrom('<img src="logo@2x.png"> plain text hero@3x.jpg', "x.com"), []);
});

test("the domain must carry a distinctive word from the practice name", () => {
  // Every directory reprints the registry phone, so phone-on-page alone had
  // "proved" these three. The domain is what they cannot fake.
  assert.deepEqual(hostMatchesName("local.yahoo.com", "ALEX MORGAN MD PSYCHIATRY SERVICES PLLC"), []);
  assert.deepEqual(hostMatchesName("ourhealthnetwork.com", "DANIEL REED MD PLLC"), []);
  assert.deepEqual(hostMatchesName("mentaltherapy.io", "MH CARE YORKTOWN"), []);
  assert.deepEqual(hostMatchesName("www.morganpsychiatry.com", "ALEX MORGAN MD PSYCHIATRY SERVICES PLLC"), ["morgan"]);
});

test("a town's own website does not match a practice named after the town", () => {
  // whiteplains.com is the City of White Plains, and this exact pair is why
  // place names are in the generic list.
  assert.deepEqual(hostMatchesName("whiteplains.com", "WHITE PLAINS FAMILY THERAPY PLLC"), []);
  assert.deepEqual(hostMatchesName("yorktown.com", "MH CARE YORKTOWN"), []);
});

test("a generic word in a domain is not a match", () => {
  assert.deepEqual(hostMatchesName("psychiatrygroup.com", "HUDSON VALLEY PSYCHIATRIC SERVICES PLLC"), []);
  assert.deepEqual(distinctive("HUDSON VALLEY FAMILY MENTAL HEALTH PLLC"), []);
});

test("a business listing is matched on the phone, never on the name", () => {
  // A places query for one practice returns its neighbours too: the Yorktown
  // query came back with three nearby psychiatrists before the right one.
  const places = [
    { title: "Metro Example Health Center", website: "https://www.metromentalhealth.example/", phoneNumber: "(800) 555-0199" },
    { title: "Harmony Example Health", website: "http://www.hmyhealth.example/", phoneNumber: "(914) 555-0142", address: "100 Example Blvd" },
    { title: "Someone Else", website: "https://other.com", phoneNumber: "(914) 999-0000" },
  ];
  const hit = placeByPhone(places, "914-555-0142");
  assert.equal(hit.host, "hmyhealth.example");
  // The trading name is worth keeping: no permutation of "DANIEL REED MD
  // PLLC" would ever produce hmyhealth.example.
  assert.equal(hit.title, "Harmony Example Health");
  assert.equal(placeByPhone(places, "914-000-1111"), null);
});

test("a listing with no website, or one pointing at a directory, is not a result", () => {
  assert.equal(placeByPhone([{ title: "X", phoneNumber: "914-555-0142" }], "914-555-0142"), null);
  assert.equal(
    placeByPhone([{ title: "X", website: "https://www.psychologytoday.com/us/therapists/x", phoneNumber: "914-555-0142" }], "914-555-0142"),
    null,
  );
});

test("a short or missing phone matches no listing", () => {
  const places = [{ title: "X", website: "https://x.com", phoneNumber: "914-555-0142" }];
  assert.equal(placeByPhone(places, null), null);
  assert.equal(placeByPhone(places, "911"), null);
});
