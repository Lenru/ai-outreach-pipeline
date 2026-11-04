import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceOf, newestStamp, hiddenSocials, bookingOf } from "./prospect-recon.mjs";

const ON = "2026-11-02";
const site = (stamps, years = []) => ({
  status: 200, url: "https://x.example",
  blog: { url: "https://x.example/blog", articles: ["How to manage anxiety at work", "b", "c"], stamps, years },
});
const publishes = (r) => evidenceOf(r, ON).find((e) => e.claim.startsWith("Publishes on the site"));

test("newestStamp takes the newest date, not the first, and reads long month names", () => {
  assert.equal(newestStamp(["Mar 3, 2024", "September 12 2026", "Sept. 1, 2025"], ON).toISOString().slice(0, 10), "2026-09-12");
});

test("newestStamp ignores future dates (upcoming events are not posts)", () => {
  assert.equal(newestStamp(["Dec 5, 2026"], ON), null);
});

test("a blog with a post in the last 12 months is proven", () => {
  const e = publishes(site(["Aug 1, 2026"]));
  assert.equal(e.proven, true);
  assert.match(e.claim, /^Publishes on the site: 3 article links on the index, newest 2026-08-01/);
});

test("a stale blog is recorded but not proven, so the drafter cannot claim it", () => {
  const e = publishes(site(["Jan 4, 2016", "Jun 2, 2024"]));
  assert.equal(e.proven, false);
  assert.match(e.claim, /Not claimable/);
});

test("years alone never prove freshness (footer copyright)", () => {
  assert.equal(publishes(site([], [2016, 2026])).proven, false);
});

// One practice's real markup: a Squarespace icon defined in script data, no <a> tag.
const RIVER = `<html xmlns:fb="http://www.facebook.com/2008/fbml"><script>{"socialAccounts":[{"profileUrl":"https://www.facebook.com/profile.php?id=10000000000001","iconEnabled":true}]}</script>
  <a href="https://www.linkedin.com/company/squarespace/">Made with Squarespace</a><img src="https://www.facebook.com/tr?id=1&ev=PageView"></html>`;

test("hiddenSocials finds a script-defined profile and skips builder links, pixels and namespaces", () => {
  assert.deepEqual(hiddenSocials(RIVER), ["https://www.facebook.com/profile.php?id=10000000000001"]);
  assert.deepEqual(hiddenSocials(String.raw`{"url":"https:\/\/www.instagram.com\/examplewellnesspllc"}`), ["https://www.instagram.com/examplewellnesspllc"]);
  assert.deepEqual(hiddenSocials(`<a href="https://www.instagram.com/">IG</a>`), []);
});

test("a hidden profile vetoes 'no social account' without becoming a claim of its own", () => {
  const ev = evidenceOf({ status: 200, url: "https://x.example", socials: {}, hiddenSocials: ["https://www.facebook.com/profile.php?id=1"] }, ON);
  assert.ok(!ev.some((e) => e.proven && /social/i.test(e.claim)));
  assert.ok(ev.some((e) => !e.proven && /Not claimable/.test(e.claim)));
  const none = evidenceOf({ status: 200, url: "https://x.example", socials: {}, hiddenSocials: [] }, ON);
  assert.ok(none.some((e) => e.proven && /^No social account is linked/.test(e.claim)));
});

test("bookingOf reads vendor hosts, not words that contain a vendor name", () => {
  assert.deepEqual(bookingOf(`<p>develop healthier coping mechanisms</p>`), []);
  assert.deepEqual(bookingOf(`<a href="https://secure.gethealthie.com/go/x">Book</a>`), ["Healthie"]);
  assert.deepEqual(bookingOf(`<a href="https://examplepractice.clientsecure.me/">Client Portal</a>`), ["SimplePractice"]);
});
