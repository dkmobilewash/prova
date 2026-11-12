import { convert } from "./priceList";
import { materialKey, sameUnit } from "./materialKey";

/**
 * ── "ORDER MATERIALS": THE ESTIMATE'S MATERIAL LINES AS A SUPPLIER'S ORDER ──
 *
 * Pure, so every rule is unit-tested; the action is `orderMaterials` in
 * lib/actions/purchaseOrders.ts.
 *
 * THE PACK, FROM WHAT THE SUPPLIER'S ROW SAYS. Nothing stores a pack size: the import
 * (#1094) read it out of the row's words to price the estimate's unit (`convert`).
 * The same reading gives the pack: a row priced per box, pail, bag, roll or piece
 * holds (its price ÷ its price per estimate unit) of the estimate's unit, so a box
 * of 5,000 screws is 5 thousand and a 61.7 lb pail is 61.7 lb. A row priced per a
 * MEASURE (MSF, SF, LF, M, LB) is bought in the estimate's own unit, except board,
 * which is bought by the sheet the row names: a 4x12 sheet is 1.5 of the estimate's
 * 4x8 sheets. The order is whole packs, rounded UP: a sub short one box stops a crew.
 */
export type QuoteRow = { id: string; description: string; unit: string | null; unitPrice: number };
export type Pack = { unit: string; perPack: number; pricePerPack: number; how: string };

const MEASURES = new Set(["msf", "sf", "lf", "mlf", "m", "lb"]);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const money = (n: number) => `$${n.toFixed(2)}`;

export function packFor(quote: QuoteRow, lineUnit: string | null, rollLf = 500): Pack | { why: string } {
  const key = materialKey(quote.description);
  if (!key) return { why: `"${quote.description}" is not a material the estimate counts` };
  const converted = convert({ description: quote.description, unit: quote.unit, price: quote.unitPrice }, key, rollLf);
  if (converted.price === null) return { why: converted.how };
  const u = sameUnit(quote.unit) ?? "";
  const ours = lineUnit ?? "unit";
  if (MEASURES.has(u)) {
    if (key.startsWith("board|")) {
      const size = quote.description.match(/(\d+(?:\.\d+)?)\s*'?\s*x\s*(\d+(?:\.\d+)?)\s*'/i);
      const sf = size ? Number(size[1]) * Number(size[2]) : 32;
      const perPack = r4(sf / 32);
      return { unit: "SHT", perPack, pricePerPack: r4(converted.price * perPack), how: `${size ? `${size[1]}x${size[2]}` : "4x8"} sheet = ${perPack} of the estimate's 4x8 sheets, ${money(converted.price * perPack)} each (${converted.how})` };
    }
    return { unit: ours, perPack: 1, pricePerPack: r4(converted.price), how: `bought by the ${ours}: ${converted.how}` };
  }
  const perPack = r4(quote.unitPrice / converted.price);
  return { unit: (quote.unit ?? "EA").toUpperCase(), perPack, pricePerPack: quote.unitPrice, how: `1 ${(quote.unit ?? "EA").toUpperCase()} = ${perPack} ${ours} (${converted.how})` };
}

/** Whole packs for a quantity in the estimate's unit, rounded up; a hair over a whole pack is that pack. */
export function packsFor(quantity: number, perPack: number): number {
  return Math.max(1, Math.ceil(quantity / perPack - 1e-6));
}

export type OrderLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  phase: { id: string; code: string; name: string } | null;
  /** The quotes from the chosen supplier that price this line's material, newest first. */
  quotes: QuoteRow[];
};
export type PlannedLine = { lineItemId: string; description: string; unit: string; quantity: number; unitPrice: number; quoteId: string; how: string };
export type PlannedOrder = { phase: OrderLine["phase"]; lines: PlannedLine[] };
export type MaterialOrderPlan = { orders: PlannedOrder[]; skipped: { description: string; why: string }[] };

/**
 * One order per phase code the lines carry (and one for the lines with none), each
 * line in whole packs at the supplier's price. A line the supplier's list does not
 * price, or prices in words that cannot be turned into packs, is SKIPPED WITH ITS
 * REASON, never guessed at: the person sees it and adds it by hand on Buyout.
 */
export function planMaterialOrder(lines: readonly OrderLine[], vendorName: string, rollLf = 500): MaterialOrderPlan {
  const byPhase = new Map<string, PlannedOrder>();
  const skipped: MaterialOrderPlan["skipped"] = [];
  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const quote = line.quotes[0];
    if (!quote) {
      skipped.push({ description: line.description, why: `not on ${vendorName}'s price list` });
      continue;
    }
    const pack = packFor(quote, line.unit, rollLf);
    if ("why" in pack) {
      skipped.push({ description: line.description, why: pack.why });
      continue;
    }
    const key = line.phase?.id ?? "";
    const order = byPhase.get(key) ?? { phase: line.phase, lines: [] };
    order.lines.push({
      lineItemId: line.id,
      description: line.phase ? `${line.phase.code} ${line.phase.name}: ${quote.description}` : quote.description,
      unit: pack.unit,
      quantity: packsFor(line.quantity, pack.perPack),
      unitPrice: pack.pricePerPack,
      quoteId: quote.id,
      how: `${line.quantity} ${line.unit ?? ""} needed; ${pack.how}`.replace(/\s+/g, " "),
    });
    byPhase.set(key, order);
  }
  // The unphased order first, then by phase code.
  const orders = [...byPhase.values()].sort((a, b) => (a.phase?.code ?? "").localeCompare(b.phase?.code ?? ""));
  return { orders, skipped };
}
