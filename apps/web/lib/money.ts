export function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * A figure that is a CHANGE rather than a balance: "+$1,500.00",
 * "−$600.00".
 *
 * The minus is U+2212, not a hyphen — it is the character the change-order
 * log on /jobs/[id] has always used, and this exists so the GC's /portal
 * copy of the same three figures cannot render them a different way. A
 * credit change order that reads "-$600.00" here and "−$600.00" there is
 * two documents about one number.
 */
export function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
}
