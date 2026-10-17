import values from "./provider-values.json";
export const industries = values.industries;
const regions = new Intl.DisplayNames(["en"], { type: "region" });
export const countryOptions = Array.from({ length: 26 * 26 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
)
  .filter(
    (code) => regions.of(code) !== code && !["EU", "UN", "UK"].includes(code),
  )
  .map((code) => ({ label: regions.of(code)!, value: code }))
  .sort((a, b) => a.label.localeCompare(b.label));
export const states =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia".split(
    "|",
  );
export const locationOptions = [
  ...new Set([
    ...countryOptions.map((c) => c.label),
    ...states.map((s) => s + " (US state)"),
    ...Object.keys(values.metros),
  ]),
];
export const titleSuggestions = [
  "Chief Marketing Officer",
  "Chief Brand Officer",
  "Marketing Director",
  "VP Marketing",
  "VP Brand",
  "Brand Director",
  "Global Marketing Director",
  "Head of Brand",
  "VP Creative Services",
  "Founder",
  "CEO",
  "Managing Director",
  "Partner",
];
export const revenueSteps = [
  0, 1e6, 5e6, 10e6, 20e6, 50e6, 100e6, 250e6, 500e6, 1e9, 5e9, 10e9,
];
export const headcountSteps = [0, 1, 10, 50, 100, 250, 500, 1000, 5000, 10000];
export function revenueLabel(n: number) {
  return n === 0
    ? "Any"
    : n >= 1e9
      ? "$" + n / 1e9 + "bn" + (n === 10e9 ? "+" : "")
      : "$" + n / 1e6 + "m";
}
export function headcountLabel(n: number) {
  return n === 0 ? "Any" : n.toLocaleString("en-US") + (n === 10000 ? "+" : "");
}
export function canonicalLocation(v: string) {
  const country = countryOptions.find(
    (c) =>
      c.label.toLowerCase() === v.toLowerCase() || c.value === v.toUpperCase(),
  );
  if (country) return country.label;
  if (locationOptions.includes(v)) return v;
  return null;
}
