# ai-outreach-pipeline

Cold email to small healthcare practices where every sentence has to trace back to a fact read off the practice's own website, and nothing sends until a person has read it and four gates pass.

Extracted from the system I run for my studio, Watson's Media. Names and data replaced. The original commit history is not included because its test fixtures held real prospect data, so this repo is a single commit.

## The pipeline

```
prospect-find          federal provider registry (NPPES) -> leads with name, town, phone
      |
prospect-enrich        search for a website, accepted only if the page carries the registry phone
      |
prospect-recon         what is actually on the site: booking tool, sitemap, robots.txt, blog, socials,
      |                clinician count, big-system ownership. Each fact saved with its URL and date
prospect-officials     the decision maker, from the registry's "authorized official"
      |
prospect-find-email    the contact address, read off the practice's own pages,
prospect-verify-email  saved with the page it was on
      |
outreach-draft         writes the email FROM proven evidence, or refuses and says why
      |
outreach-queue         drafts wait as 'pending'
      |
outreach-approve       a person reads each one in full and approves it
      |
outreach-send          4 gates + a live re-check of the site, 20/day cap, dry run unless --write
      |
outreach-followup      two follow-ups a week apart, then stop. Held on any reply
      |
prospect-reply.gs      Apps Script inside Gmail logs replies onto the CRM record
```

All scripts are in `src/`. Each one is a dry run unless you pass `--write`.

## Decisions worth knowing about

**1. The email can only say what the evidence proves.** The first hand-personalised batch told a practice "you're already writing posts for the site" when it had no blog. So the drafter now builds its one observation from evidence rows marked `proven`, each carrying the URL it came from. If there is no proven fact to build on, or no named person to address, it writes nothing and prints the reason (`outreach-draft.mjs`). Gate 3 then checks the final text against a closed list of claim patterns, so a sentence the evidence does not back is blocked even if a template change lets it through (`outreach-gates.mjs`).

**2. No model touches contact details.** An LLM lead-finder used earlier invented plausible addresses and returned chains as independent practices. Addresses are now found with a fetch and a regex on the practice's own site, and gate 3 refuses any recipient unless a proven evidence row records the page on the practice's own domain where it was read. A website counts as theirs only if the page shows the phone number from the federal registry; a name match resolved one practice to its town's city website (`prospect-enrich.mjs`).

**3. Four gates run on the exact bytes at send time, not at draft time.** (1) A CAN-SPAM footer with an opt-out and a postal address from config; a missing or placeholder address aborts the run. (2) A stop list read from the CRM's own touches when sending, because a draft written Monday can go out Friday after they replied "stop"; bounces, a do-not-contact flag and ownership by a large health system also stop it. (3) The text gate above, plus a named decision maker, no foreign domains and no em dashes. (4) A 20-a-day cap counted across every prospect in the CRM, so it holds across runs and terminals, because a new sending domain that bursts gets classified as spam. `--cap` can only lower it.

**4. The site is re-checked live right before sending.** Stored evidence can be wrong or stale: "Healthie" was once read out of the word "healthier". So `outreach-live.mjs` re-opens the site and confirms the one fact the email states. If it cannot confirm it, timeouts included, the email does not go.

**5. A human approves words; the gates still decide.** The queue only ever writes `pending`. Approval means someone read the whole body; it cannot prove the footer survived or the address came off the practice's own site, so `outreach-send.mjs --approved` runs every gate again. Sending is the only step that emails anyone, it logs the full body on the CRM record, and it skips anyone already sent the same subject or follow-up, so a re-run never mails someone twice.

## Run it

Node 20.12 or newer. No dependencies.

```
npm test        # 119 tests, no network, no keys
npm run demo    # draft, plan follow-ups, then dry-run both sends on the example data
```

The demo uses `example/crm.json` (seven fictional practices) and saved copies of their sites in `example/sites/`, so the live check needs no network. It shows one email that would send, one blocked because the site changed since recon (robots.txt now exists), one blocked because nobody recorded where its address came from, one stopped because a large system owns the practice, a follow-up held because they asked to stop, and a refusal for a practice with no named decision maker.

The approval flow, against the same data:

```
node src/outreach-queue.mjs --write --followups
node src/outreach-approve.mjs                  # read every pending draft in full
node src/outreach-approve.mjs --approve=1
node --env-file=example/demo.env src/outreach-send.mjs --approved
```

Writes go to `data/crm.json`, copied from the example on first use. Set `CRM_FILE` to use another file.

Real runs need: `SERPER_API_KEY` for `prospect-enrich`, and `RESEND_API_KEY` plus `OUTREACH_POSTAL_ADDRESS` for `outreach-send --write`. The registry lookups use the free public NPPES API.

## What changed in the extraction

In production the CRM is a set of database functions behind a web hub where drafts are approved. Here every script reaches it through `src/lib/store.mjs`, a JSON-file store with the same function names, so it can be swapped for a real database without touching the scripts. The hub's approval page became `outreach-approve.mjs`, and team chat notifications were removed. Sibling sourcing scripts (Google Maps leads, LLM lead imports, Maps rank, headcount and phone-to-registry matching) were left out to keep the path readable.

## License

MIT
