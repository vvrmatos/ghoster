import test from "node:test";
import assert from "node:assert/strict";
import { recordHistory, stepHistory } from "./history.js";

test("records, goes back, and goes forward", () => {
  const tab = { history: [], historyIndex: -1 };
  recordHistory(tab, "https://one.example");
  recordHistory(tab, "https://two.example");

  assert.equal(stepHistory(tab, -1), "https://one.example");
  assert.equal(stepHistory(tab, 1), "https://two.example");
  assert.equal(stepHistory(tab, 1), null);
});

test("new navigation truncates forward history", () => {
  const tab = {
    history: ["https://one.example", "https://two.example"],
    historyIndex: 0,
  };
  recordHistory(tab, "https://three.example");
  assert.deepEqual(tab.history, ["https://one.example", "https://three.example"]);
  assert.equal(tab.historyIndex, 1);
});

test("does not duplicate the current URL", () => {
  const tab = { history: ["https://one.example"], historyIndex: 0 };
  recordHistory(tab, "https://one.example");
  assert.deepEqual(tab.history, ["https://one.example"]);
});
