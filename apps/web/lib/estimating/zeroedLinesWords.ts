/**
 * The words for a priced takeoff line a sync took to 0 (order (e), A2): one sentence, the lines named with their price.
 * Pure, so the screens and their tests read the same sentence.
 */
const money = (price: string | null) => (price === null ? "your cost" : `$${Number(price).toFixed(2)}`);

export function zeroedLinesSentence(lines: readonly { description: string; unitPrice: string | null }[]): string {
  if (lines.length === 0) return "";
  const named = lines.slice(0, 3).map((l) => `${l.description} (${money(l.unitPrice)})`);
  const more = lines.length > 3 ? `, and ${lines.length - 3} more` : "";
  const one = lines.length === 1;
  return `On the estimate at 0 ft, with the price you typed kept: ${named.join("; ")}${more}. ${one ? "Its" : "Their"} walls are gone from the takeoff.`;
}

/** The item-delete confirmation's keep box (order (e), C2): what the person priced, and what keeping it means. */
export function handPricedKeepLabel(lines: readonly { description: string; total: number }[]): string {
  const total = `$${lines.reduce((n, l) => n + l.total, 0).toFixed(2)}`;
  const what = lines.length === 1 ? `the line you priced by hand (${lines[0]!.description}, ${total})` : `the ${lines.length} lines you priced by hand (${total})`;
  return `Keep ${what} on the estimate as a typed line`;
}

/** The estimate row's own flag for one such line. */
export const ZEROED_ROW_FLAG = "0 — its walls are gone; your price is kept for when they come back";
