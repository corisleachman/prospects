export type BudgetOverview = {
  budget: {
    id: string;
    amount: number;
    currency: string;
    period_start: string;
    period_end: string;
    status: string;
    note: string;
    is_test: boolean;
  };
  spent: number;
  reserved: number;
  today_spent: number;
  days_left: number;
};
export function money(v: number | string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(Number(v));
}
export function budgetNumbers(o: BudgetOverview) {
  const remaining = Math.max(Number(o.budget.amount) - Number(o.spent), 0);
  return {
    remaining,
    available: Math.max(remaining - Number(o.reserved), 0),
    softCap: remaining / Math.max(o.days_left, 1),
  };
}
export function amount(s: FormDataEntryValue | null) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000)
    throw new Error("Enter a positive amount up to £1,000,000.");
  return n;
}

export function tokenCostGBP(
  units: Record<string, number>,
  rates: Record<string, number>,
  batch: boolean,
) {
  let cost = 0;
  for (const [unit, rate] of [
    ["input_tokens", "input_per_million"],
    ["output_tokens", "output_per_million"],
    ["cache_read_input_tokens", "cache_read_per_million"],
    ["cache_creation_input_tokens", "cache_write_per_million"],
  ]) {
    const count = units[unit] ?? 0;
    if (!Number.isFinite(count) || count < 0)
      throw new Error("Invalid token count");
    if (count) {
      const price = rates[rate];
      if (!Number.isFinite(price) || price < 0)
        throw new Error("Missing valid GBP pricing for " + rate);
      cost += (count * price) / 1000000;
    }
  }
  if (batch) {
    const multiplier = rates.batch_multiplier;
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1)
      throw new Error("Missing valid batch multiplier");
    cost *= multiplier;
  }
  return Math.ceil(cost * 1000000) / 1000000;
}

export function costMoney(v: number | string) {
  const n = Number(v);
  return n > 0 && n < 0.01
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }).format(n)
    : money(n);
}
