import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCostGBP, budgetNumbers } from "../src/lib/budget";
test("token costs use configured cached and batch prices, with no assumed rate", () => {
  assert.equal(
    tokenCostGBP(
      {
        input_tokens: 1000000,
        output_tokens: 1000000,
        cache_read_input_tokens: 1000000,
      },
      {
        input_per_million: 1,
        output_per_million: 4,
        cache_read_per_million: 0.1,
        batch_multiplier: 0.5,
      },
      true,
    ),
    2.55,
  );
  assert.throws(() => tokenCostGBP({ input_tokens: 1 }, {}, false), /Missing/);
  assert.throws(
    () => tokenCostGBP({ input_tokens: -1 }, { input_per_million: 1 }, false),
    /Invalid/,
  );
  assert.throws(
    () => tokenCostGBP({ output_tokens: 1 }, { output_per_million: 1 }, true),
    /batch/,
  );
});
test("remaining budget subtracts reservations and never goes negative", () => {
  const n = budgetNumbers({
    budget: {
      id: "b",
      amount: 10,
      currency: "GBP",
      period_start: "2026-10-16",
      period_end: "2026-11-16",
      status: "active",
      note: "",
      is_test: true,
    },
    spent: 8,
    reserved: 1,
    today_spent: 8,
    days_left: 2,
  });
  assert.deepEqual(n, { remaining: 2, available: 1, softCap: 1 });
});
