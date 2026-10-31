import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./loadTypeScript.mjs";

const { factorDirectionView, oppositeGroup } = loadTypeScript("../src/assets/lib/factorDirection.ts");
const { restoredCardOrder } = loadTypeScript("../src/assets/lib/cardOrder.ts");
const parameters = { n_groups: 3, n_select: 2 };
const labels = ["最小 2 支", "Group 1", "Group 2", "Group 3", "最大 2 支"];

function sample() {
  return {
    information: [
      { time: "2026-06-01", ic: 0.2, rankIc: -0.4, icCumulative: 0.2, rankIcCumulative: -0.4 },
      { time: "2026-06-02", ic: null, rankIc: 0, icCumulative: 0.2, rankIcCumulative: -0.4 }
    ],
    longShort: [
      { time: "2026-06-01", value: 0.1, cumulative: 0.1 },
      { time: "2026-06-02", value: null, cumulative: null },
      { time: "2026-06-03", value: -0.04, cumulative: 0.06 }
    ],
    groups: [{
      time: "2026-06-01",
      values: Object.fromEntries(labels.map((label, i) => [label, 1 + i / 10])),
      reverseValues: Object.fromEntries(labels.map((label, i) => [label, 2 + i / 10]))
    }],
    groupStatistics: labels.map((group, i) => ({ group, mean: i / 100, pValue: i / 10 })),
    decay: [{ returnColumn: "P5L1", label: "P5L1", position: 0, icMean: 0.03, rankIcMean: -0.08 },
      { returnColumn: "P5L2", label: "P5L2", position: 1, icMean: null, rankIcMean: 0 }],
    turnover: { periods: 5, rankAutocorrelation: 0.75, groups: labels.map((group, i) => ({ group, value: i / 10 })) }
  };
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("original direction is a zero-copy view of the original results", () => {
  const input = sample();
  assert.strictEqual(factorDirectionView(input, "original", parameters), input);
});

test("inverted IC, RankIC, cumulative IC and every decay horizon change sign", () => {
  const input = freeze(sample());
  const view = factorDirectionView(input, "inverted", parameters);
  assert.equal(view.information[0].ic, -0.2);
  assert.equal(view.information[0].rankIc, 0.4);
  assert.equal(view.information[0].icCumulative, -0.2);
  assert.equal(view.information[0].rankIcCumulative, 0.4);
  assert.equal(view.information[1].ic, null);
  assert.equal(view.information[1].rankIc, 0);
  assert.equal(view.decay[0].icMean, -0.03);
  assert.equal(view.decay[0].rankIcMean, 0.08);
  assert.equal(view.decay[1].icMean, null);
  assert.deepEqual(view.decay.map((row) => row.returnColumn), ["P5L1", "P5L2"]);
});

test("long-short log returns invert while dates and missing observations remain intact", () => {
  const input = freeze(sample());
  const view = factorDirectionView(input, "inverted", parameters);
  assert.deepEqual(view.longShort, [
    { time: "2026-06-01", value: -0.1, cumulative: -0.1 },
    { time: "2026-06-02", value: null, cumulative: null },
    { time: "2026-06-03", value: 0.04, cumulative: -0.06 }
  ]);
  // Direction applies to log returns, not to NAV: inverted NAV must be positive and reciprocal.
  assert.ok(Math.abs(Math.exp(view.longShort[2].cumulative) * Math.exp(input.longShort[2].cumulative) - 1) < 1e-12);
});

test("group curves and reverse-time curves exchange saved portfolios, not their signs", () => {
  const input = freeze(sample());
  const view = factorDirectionView(input, "inverted", parameters);
  assert.deepEqual(Object.keys(view.groups[0].values), labels);
  assert.equal(view.groups[0].values["最小 2 支"], 1.4);
  assert.equal(view.groups[0].values["最大 2 支"], 1);
  assert.equal(view.groups[0].values["Group 1"], 1.3);
  assert.equal(view.groups[0].values["Group 2"], 1.2);
  assert.equal(view.groups[0].values["Group 3"], 1.1);
  assert.equal(view.groups[0].reverseValues["Group 1"], 2.3);
  assert.equal(view.groups[0].time, input.groups[0].time);
});

test("group means and p-values move together instead of negating a portfolio return", () => {
  const view = factorDirectionView(sample(), "inverted", parameters);
  assert.deepEqual(view.groupStatistics[0], { group: "最小 2 支", mean: 0.04, pValue: 0.4 });
  assert.deepEqual(view.groupStatistics[1], { group: "Group 1", mean: 0.03, pValue: 0.3 });
  assert.deepEqual(view.groupStatistics.at(-1), { group: "最大 2 支", mean: 0, pValue: 0 });
});

test("turnover groups exchange but rank autocorrelation and holding period do not change", () => {
  const view = factorDirectionView(sample(), "inverted", parameters);
  assert.equal(view.turnover.rankAutocorrelation, 0.75);
  assert.equal(view.turnover.periods, 5);
  assert.deepEqual(view.turnover.groups.map((row) => row.group), labels);
  assert.deepEqual(view.turnover.groups.map((row) => row.value), [0.4, 0.3, 0.2, 0.1, 0]);
});

test("switching back to original cannot retain inverted values or mutate raw results", () => {
  const input = freeze(sample());
  const before = JSON.stringify(input);
  const inverted = factorDirectionView(input, "inverted", parameters);
  assert.deepEqual(factorDirectionView(inverted, "inverted", parameters), input);
  assert.strictEqual(factorDirectionView(input, "original", parameters), input);
  assert.equal(JSON.stringify(input), before);
});

for (const count of [2, 3, 5, 10]) {
  test(`all ${count} group labels form a reversible direction mapping`, () => {
    for (let index = 1; index <= count; index++) {
      const label = `Group ${index}`;
      assert.equal(oppositeGroup(label, count, 2), `Group ${count + 1 - index}`);
      assert.equal(oppositeGroup(oppositeGroup(label, count, 2), count, 2), label);
    }
    assert.equal(oppositeGroup("arbitrary group", count, 2), "arbitrary group");
  });
}

test("empty series, missing turnover and null portfolio values stay missing", () => {
  const empty = { information: [], longShort: [], groups: [], groupStatistics: [], decay: [], turnover: null };
  assert.deepEqual(factorDirectionView(empty, "inverted", parameters), empty);
  const input = sample();
  input.groups[0].values["Group 3"] = null;
  input.groups[0].reverseValues["Group 3"] = null;
  input.groupStatistics[3] = { group: "Group 3", mean: null, pValue: null };
  input.turnover.groups[3].value = null;
  const view = factorDirectionView(input, "inverted", parameters);
  assert.equal(view.groups[0].values["Group 1"], null);
  assert.equal(view.groups[0].reverseValues["Group 1"], null);
  assert.equal(view.groupStatistics[1].pValue, null);
  assert.equal(view.turnover.groups[1].value, null);
});

const previous = ["execution-statistics", "information", "returns", "groups", "turnover", "decay"];
const current = ["information", "returns", "groups", "turnover", "decay", "execution-statistics"];

test("new reports and old default card order put DSL execution statistics last", () => {
  assert.deepEqual(restoredCardOrder(null, current, previous), current);
  assert.deepEqual(restoredCardOrder([], current, previous), current);
  assert.deepEqual(restoredCardOrder(previous, current, previous), current);
  assert.deepEqual(restoredCardOrder(current, current, previous), current);
});

test("manually sorted report cards retain their saved order", () => {
  const custom = ["groups", "execution-statistics", "returns", "information", "decay", "turnover"];
  assert.deepEqual(restoredCardOrder(custom, current, previous), custom);
  assert.deepEqual(restoredCardOrder(["groups", "groups", "unknown"], current, previous), ["groups", ...current.filter((id) => id !== "groups")]);
});
