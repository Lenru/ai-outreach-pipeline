import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFails } from "./outreach-live.mjs";

// A fake web: url -> [status, body]. Anything missing is a 404 page.
const web = (pages) => async (url) => {
  const [status, text] = pages[url] ?? [404, "<html>not found</html>"];
  return { status, text: async () => text };
};
const P = (extra = {}) => ({ website: "https://x.example", evidence: [], ...extra });

test("the Healthie email (2026-11-02) is blocked: 'healthier' is not a booking link", async () => {
  const f = await liveFails("Clients book with you through Healthie, but can you tell",
    P(), { fetch: web({ "https://x.example": [200, "<p>healthier coping</p>"], "https://x.example/": [200, "<p>healthier</p>"] }) });
  assert.match(f.join(), /no link to Healthie/);
});

test("a real booking link on the page the evidence cites passes", async () => {
  const ev = [{ proven: true, claim: "Takes bookings through SimplePractice.", source: "https://x.example/portal" }];
  const f = await liveFails("Clients book with you through SimplePractice, but", P({ evidence: ev }),
    { fetch: web({ "https://x.example/portal": [200, '<a href="https://examplepractice.clientsecure.me/">Portal</a>'] }) });
  assert.deepEqual(f, []);
});

test("site basics: blocked when a sitemap or robots.txt exists now, passes when they are 404", async () => {
  const body = `There's no sitemap, no robots.txt, and the page title just says "WELCOME TO OAKVIEW!".`;
  const home = { "https://x.example/": [200, "<title>WELCOME TO OAKVIEW!</title>"] };
  assert.deepEqual(await liveFails(body, P(), { fetch: web(home) }), []);
  const fixed = await liveFails(body, P(), { fetch: web({ ...home,
    "https://x.example/sitemap_index.xml": [200, "<?xml?><sitemapindex>"], "https://x.example/robots.txt": [200, "User-agent: *\nSitemap: https://x.example/s.xml"] }) });
  assert.equal(fixed.length, 3);
});

test("a changed page title is blocked", async () => {
  const f = await liveFails(`the page title just says "Home"`, P(), { fetch: web({ "https://x.example/": [200, "<title>Therapy in Beacon NY</title>"] }) });
  assert.match(f.join(), /now "Therapy in Beacon NY"/);
});

test("any Google Maps rank is blocked outright (Noah cut it 2026-11-02)", async () => {
  const body = `When I searched "psychologist Harrison NY" on Google Maps on Saturday, you came up 4th.`;
  assert.match((await liveFails(body, P(), { fetch: web({}) })).join(), /Maps rank/);
  assert.deepEqual(await liveFails("Clients book with you through Jane, but", P(), { fetch: web({ "https://x.example": [200, '<a href="https://x.janeapp.com">Book</a>'] }) }), []);
});

test("a site that will not load blocks the send instead of waving it through", async () => {
  const f = await liveFails("Clients book with you through Jane, but", P(), { fetch: async () => { throw new Error("timeout"); } });
  assert.match(f.join(), /could not load/);
});

test("a rank is blocked even without the words 'Google Maps'", async () => {
  assert.match((await liveFails("You came up 6th for therapists nearby.", P(), { fetch: web({}) })).join(), /Maps rank/);
  assert.match((await liveFails("Your practice ranks 4 locally.", P(), { fetch: web({}) })).join(), /Maps rank/);
});
