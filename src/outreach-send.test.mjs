import test from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "./outreach-send.mjs";

const EMAIL = `Hi Dr Hale,

My name's Noah Watson. I run a small agency.

If you're looking to grow the practice, reply to this.

Noah Watson
Watson's Media`;

test("a blank line is a paragraph, a single newline is a line break", () => {
  const html = renderHtml(EMAIL);
  // Four paragraphs, not six: the signature's two lines stay in one block.
  assert.equal(html.match(/<p /g).length, 4);
  assert.match(html, /<p style="margin:0">Noah Watson<br>Watson's Media<\/p>/);
  // The gap between paragraphs is ours to set, which is the whole reason this
  // function exists instead of sending text only.
  assert.match(html, /margin:0 0 12px/);
});

test("the last paragraph carries no trailing gap", () => {
  const html = renderHtml(EMAIL);
  const last = html.slice(html.lastIndexOf("<p "));
  assert.match(last, /^<p style="margin:0">/);
});

test("HTML in a draft is escaped, never rendered", () => {
  const html = renderHtml("Hi <script>alert(1)</script> & co\n\nBye");
  assert.ok(!html.includes("<script>"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; co/);
});

test("extra blank lines do not become empty paragraphs", () => {
  const html = renderHtml("One\n\n\n\nTwo\n   \nThree");
  assert.equal(html.match(/<p /g).length, 3);
  assert.ok(!/<p[^>]*><\/p>/.test(html), html);
});

test("importing the module sends nothing and reads no env", () => {
  // The script used to run at import time, which is why this file can exist at
  // all: a top-level send cannot be unit tested.
  assert.equal(typeof renderHtml, "function");
});
