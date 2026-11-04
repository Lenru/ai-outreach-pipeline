// Runs src/prospect-reply.gs against a fake Gmail that behaves like GmailApp.search:
// labels match at THREAD level, so "-label:CRM" hides a whole labelled conversation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("./prospect-reply.gs", import.meta.url), "utf8");
const DAY = 864e5;

function run(threads) {
  const calls = [];
  const msg = (id, from, ageDays) => ({
    getId: () => id, getFrom: () => from, getSubject: () => "Re: social media",
    getPlainBody: () => "hello", getDate: () => new Date(Date.now() - ageDays * DAY),
    getHeader: () => "dmarc=pass",
  });
  const fake = threads.map((t) => ({ labels: new Set(t.labels), msgs: t.msgs.map((m) => msg(...m)) }));
  const ctx = {
    GmailApp: {
      getUserLabelByName: () => ({ name: "CRM" }),
      createLabel: () => ({ name: "CRM" }),
      search: (q) => fake
        .filter((t) => !(q.includes("-label:CRM") && t.labels.has("CRM")))
        .map((t) => ({ getMessages: () => t.msgs, addLabel: () => t.labels.add("CRM") })),
    },
    Session: { getActiveUser: () => ({ getEmail: () => "noah@watsonsmedia.com" }) },
    UrlFetchApp: {
      fetch: (url, opt) => {
        const fn = url.split("/rpc/")[1], body = JSON.parse(opt.payload);
        if (fn === "prospect_reply") calls.push(body.p_message_id);
        const out = fn === "prospect_senders" ? { emails: [], domains: ["stillwaterpsych.example"] } : "logged";
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out) };
      },
    },
  };
  vm.runInNewContext(src + "\ncheckReplies();", ctx);
  return calls;
}

test("a new reply in a thread already labelled CRM is still captured", () => {
  const calls = run([{ labels: ["CRM"], msgs: [
    ["first", "Fred Dalton <drdalton@stillwaterpsych.example>", 2.5],
    ["mine", "Noah Watson <noah@watsonsmedia.com>", 2],
    ["second", "Fred Dalton <drdalton@stillwaterpsych.example>", 0.1],
  ] }]);
  assert.ok(calls.includes("second"));
});

test("messages older than the 3-day window are not re-sent", () => {
  const calls = run([{ labels: ["CRM"], msgs: [
    ["old", "Fred Dalton <drdalton@stillwaterpsych.example>", 8],
    ["new", "Fred Dalton <drdalton@stillwaterpsych.example>", 0.1],
  ] }]);
  assert.deepEqual(calls, ["new"]);
});

test("mail from a non-prospect never leaves Gmail", () => {
  assert.deepEqual(run([{ labels: [], msgs: [["x", "Someone <a@else.com>", 0.1]] }]), []);
});
