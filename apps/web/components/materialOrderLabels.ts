/** Shared material-order display semantics, so the form, the row and the
 * counters can't disagree about what state an order is in.
 *
 * There is NO stored status. State is derived from the deliveries on
 * every render — a stored status can disagree with the deliveries
 * underneath it, and then "still waiting on it" and "it's all here" are
 * both true on the same screen.
 */

export type DeliveryData = {
  id: string;
  deliveredOn: string;
  completesOrder: boolean;
  notes: string | null;
};

export type MaterialOrderState =
  | "AWAITING" // nothing has shown up yet
  | "PARTIAL" // some of it is here, the order isn't closed out
  | "COMPLETE"; // a delivery closed it out

export function closingDelivery(deliveries: DeliveryData[]): DeliveryData | null {
  return deliveries.find((d) => d.completesOrder) ?? null;
}

export function orderState(deliveries: DeliveryData[]): MaterialOrderState {
  if (closingDelivery(deliveries)) return "COMPLETE";
  return deliveries.length === 0 ? "AWAITING" : "PARTIAL";
}

export function stateLabel(state: MaterialOrderState) {
  switch (state) {
    case "AWAITING":
      return "Nothing here yet";
    case "PARTIAL":
      return "Partly delivered";
    case "COMPLETE":
      return "Delivered";
  }
}

/** Late = the vendor's own promised date has passed and the order still
 * isn't complete. Derived on every render; `today` comes from the server
 * so server and browser can't disagree about the date.
 *
 * An order with no promised date is never late — nobody committed to
 * anything, so there is nothing to be late against. Inventing a date to
 * measure against would manufacture lateness that no vendor agreed to. */
export function isLate(deliveries: DeliveryData[], promisedFor: string | null, today: string) {
  if (!promisedFor) return false;
  return orderState(deliveries) !== "COMPLETE" && promisedFor < today;
}

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string) {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/** How many days past the promised date an incomplete order is. Null when
 * it isn't late, so the caller can't render "0 days late". */
export function daysLate(deliveries: DeliveryData[], promisedFor: string | null, today: string) {
  if (!isLate(deliveries, promisedFor, today)) return null;
  return daysBetween(promisedFor as string, today);
}
