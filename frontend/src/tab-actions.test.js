import test from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex, numberedTabIndex, rememberClosed } from "./tab-actions.js";

test("tab cycling wraps in both directions", () => {
  assert.equal(nextTabIndex(3, 2, 1), 0);
  assert.equal(nextTabIndex(3, 0, -1), 2);
});

test("number shortcuts select 1-8 and 9 selects last", () => {
  assert.equal(numberedTabIndex(1, 4), 0);
  assert.equal(numberedTabIndex(3, 4), 2);
  assert.equal(numberedTabIndex(8, 4), 3);
  assert.equal(numberedTabIndex(9, 4), 3);
});

test("closed-tab memory is bounded", () => {
  const stack = [];
  for (let i = 0; i < 12; i++) rememberClosed(stack, { id: i });
  assert.equal(stack.length, 10);
  assert.equal(stack[0].id, 2);
  assert.equal(stack[9].id, 11);
});
