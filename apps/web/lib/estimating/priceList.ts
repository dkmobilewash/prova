import { parseCsvRecords } from "@/lib/catalog-import";
import { materialKey, partOf, sameUnit } from "./materialKey";

/**
 * ── A SUPPLIER'S PRICE LIST, READ INTO THE COMPANY'S OWN MATERIALS ──
 *
 * The rows are the supplier's words; this decides, by code, which of the company's materials each
 * row prices and at what figure in the unit the estimate counts. Nothing here invents a price: a row
 * whose material cannot be read, or whose unit cannot be turned into the estimate's from what the row
 * itself STATES (a box's count, a pail's weight, a roll's length, a sheet's size), prices nothing and
 * is kept for reference only. Every conversion is spelled out on the row so a person can check it
 * against the paper.
 *
 * Runs twice on purpose, like every import here: in the browser for the preview, then on the server
 * over the same text before anything is written, so the preview cannot be a claim.
 */

export type ColumnMap = { item: number; size: number | null; unit: number | null; price: number };

/** The estimate's unit for each kind of material — what a catalog entry made from a price list is priced in. */
const CANONICAL_UNIT: Record<string, string> = {
  board: "SHT",
  screws: "M",
  compound: "LB",
  tape: "RL",
  track: "LF",
  deflection: "LF",
  stud: "EA",
  insulation: "SF",
  "corner-bead": "EA",
};

export const MAX_PRICE_ROWS = 1000;

/**
 * The supplier's email for orders, when the list prints one: the first address above the price
 * table that is not on a customer, bill-to, ship-to or sold-to line (that one is the buyer's own).
 * Only a suggestion for the import form, which a person reads and can change before Import.
 */
export function contactEmailIn(text: string): string | null {
  for (const line of text.split(/\r?\n/).slice(0, 40)) {
    if (isHeaderRow(line.split(","))) break;
    if (/customer|bill\s*to|ship\s*to|sold\s*to/i.test(line)) continue;
    const found = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.exec(line);
    if (found) return found[0];
  }
  return null;
}

/** The rows of a price list's text and the header the columns are named by. */
export function priceListTable(text: string): { header: string[]; rows: { line: number; cells: string[] }[] } {
  const records = parseCsvRecords(text).map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) }));
  const nonEmpty = records.filter((r) => r.cells.some((c) => c !== ""));
  // The header is the first row naming both an item and a price; a list with none is read positionally.
  const at = nonEmpty.findIndex((r) => isHeaderRow(r.cells));
  if (at === -1) return { header: [], rows: nonEmpty.slice(0, MAX_PRICE_ROWS) };
  return { header: nonEmpty[at].cells, rows: nonEmpty.slice(at + 1, at + 1 + MAX_PRICE_ROWS) };
}

/** A row naming both an item and a price is the table's header. */
export function isHeaderRow(cells: readonly string[]): boolean {
  return cells.some((c) => ITEM_HEAD.test(c)) && cells.some((c) => PRICE_HEAD.test(c));
}

const ITEM_HEAD = /\b(?:item|description|product|material|desc)\b/i;
const SIZE_HEAD = /\b(?:size|dimension|dims?)\b/i;
const UNIT_HEAD = /^(?:u\/?m|uom|unit|units|per|unit of measure)$/i;
const PRICE_HEAD = /\b(?:price|cost|net|each|unit price|ext)\b/i;

/** Which column is which, from the header's words. Price prefers a unit price over an extended total. */
export function guessColumns(header: string[]): ColumnMap | null {
  const find = (re: RegExp, not?: RegExp) => header.findIndex((h) => re.test(h) && !(not?.test(h) ?? false));
  // The words, not the SKU: "Description" over "Item #".
  const words = find(/\b(?:description|desc|product|material)\b/i);
  const item = words >= 0 ? words : find(ITEM_HEAD, /#|\bno\.?$|\bnumber\b|\bsku\b|\bcode\b/i);
  const price = [find(/\bunit\s*price\b|\bnet\s*price\b|\bprice\s*each\b/i), find(PRICE_HEAD, /\b(?:ext|extended|total|amount)\b/i), find(PRICE_HEAD)].find((i) => i >= 0) ?? -1;
  if (item < 0 || price < 0) return null;
  const size = find(SIZE_HEAD);
  const unit = header.findIndex((h) => UNIT_HEAD.test(h.trim()));
  return { item, size: size < 0 ? null : size, unit: unit < 0 ? null : unit, price };
}

export type ReadRow = {
  line: number;
  /** The supplier's words: item and size together. */
  description: string;
  unit: string | null;
  price: number | null;
  /** The company material this row is, or null when its words do not say. */
  key: string | null;
  /** The estimate's unit for that material. */
  ourUnit: string | null;
  /** The row's price in `ourUnit`, or null when the row does not state what would convert it. */
  ourPrice: number | null;
  /** "$6.95 per 500 ft roll = $6.95 per 500 ft roll", the arithmetic in words — or why there is none. */
  how: string;
  /** A stud's stated length: the price is for that stud, and a wall taller than it needs another. */
  studLengthFt: number | null;
};

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2).replace(/(\.\d\d)00$/, "$1")}`;
const num = (s: string) => Number(s.replace(/,/g, ""));

/** A price cell: "$12.40", "12.40 ea", "1,240.00". Null for anything else. */
export function priceFrom(cell: string): number | null {
  const m = cell.replace(/\s/g, "").match(/^\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?:\/?[a-z]+)?$/i);
  if (!m) return null;
  const n = num(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Feet stated in the words — `10'`, `10 ft`, `500'` — never an inch size. */
function feetIn(d: string): number | null {
  const m = d.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:'(?!')|ft\b|feet\b|lf\b)/i);
  return m ? num(m[1]) : null;
}

/**
 * The row's price in the estimate's unit, from facts the row states. Null with the reason otherwise.
 * `rollLf` is the company's tape roll length.
 */
export function convert(row: { description: string; unit: string | null; price: number }, key: string, rollLf: number): { price: number; how: string } | { price: null; how: string } {
  const kind = key.split("|")[0];
  const our = CANONICAL_UNIT[kind];
  const u = sameUnit(row.unit) ?? "";
  const d = row.description.toLowerCase();
  const p = row.price;
  const per = `${money(p)} per ${row.unit ?? "unit"}`;
  const none = (why: string) => ({ price: null, how: `${per}: ${why}` });
  switch (kind) {
    case "board": {
      if (u === "msf") return { price: (p * 32) / 1000, how: `${per} = ${money((p * 32) / 1000)} per 4x8 sheet (32 sf)` };
      if (u === "sf") return { price: p * 32, how: `${per} = ${money(p * 32)} per 4x8 sheet` };
      if (u === "sheet" || u === "ea" || u === "") {
        const size = row.description.match(/(\d+(?:\.\d+)?)\s*'?\s*x\s*(\d+(?:\.\d+)?)\s*'/i) ?? row.description.match(/\b(4)\s*x\s*(8|9|10|12|14)\b/i);
        if (!size) return none("the sheet size is not stated, so it cannot be turned into a 4x8 sheet");
        const sf = Number(size[1]) * Number(size[2]);
        return sf === 32 ? { price: p, how: `${per} 4x8 sheet` } : { price: (p * 32) / sf, how: `${per} ${size[1]}x${size[2]} sheet (${sf} sf) = ${money((p * 32) / sf)} per 4x8 sheet` };
      }
      return none(`a board price per ${row.unit} has no stated size in sheets`);
    }
    case "screws": {
      if (u === "m") return { price: p, how: `${per} thousand` };
      const counted = d.match(/(\d[\d,]*)\s*(?:\/\s*(?:box|bx|ctn|carton|pail|bucket)\b|ct\b|count\b|pcs?\b|per\s+box\b)/);
      const thousands = d.match(/\b(\d+)\s*m\b/);
      const n = counted ? num(counted[1]) : thousands ? Number(thousands[1]) * 1000 : null;
      if (!n) return none("the number of screws in the box is not stated");
      return { price: (p * 1000) / n, how: `${per} of ${n.toLocaleString("en-US")} = ${money((p * 1000) / n)} per thousand` };
    }
    case "compound": {
      if (u === "lb") return { price: p, how: `${per}` };
      const lb = d.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/);
      if (!lb) return none("the weight is not stated (a gallon of compound is not a fixed number of pounds)");
      return { price: p / Number(lb[1]), how: `${per} of ${lb[1]} lb = ${money(p / Number(lb[1]))} per lb` };
    }
    case "tape": {
      const ft = feetIn(row.description);
      if (u === "lf") return { price: p * rollLf, how: `${per} = ${money(p * rollLf)} per ${rollLf} ft roll` };
      if (!ft) return none("the roll length is not stated");
      return { price: (p * rollLf) / ft, how: ft === rollLf ? `${per} ${ft} ft roll` : `${per} ${ft} ft roll = ${money((p * rollLf) / ft)} per ${rollLf} ft roll` };
    }
    case "track":
    case "deflection": {
      if (u === "lf") return { price: p, how: per };
      if (u === "mlf") return { price: p / 1000, how: `${per} = ${money(p / 1000)} per LF` };
      const ft = feetIn(row.description);
      if (!ft) return none("the piece length is not stated");
      return { price: p / ft, how: `${per} ${ft} ft piece = ${money(p / ft)} per LF` };
    }
    case "stud": {
      if (u === "ea" || u === "" || u === "pc") return { price: p, how: `${per} stud${feetIn(row.description) ? ` (${feetIn(row.description)} ft)` : ""}` };
      return none(`a stud priced per ${row.unit} has no length in studs`);
    }
    case "insulation": {
      if (u === "sf") return { price: p, how: per };
      if (u === "msf") return { price: p / 1000, how: `${per} = ${money(p / 1000)} per sf` };
      const sf = d.match(/(\d+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft)\b/);
      if (!sf) return none("the square feet in the bag are not stated");
      return { price: p / Number(sf[1]), how: `${per} of ${sf[1]} sf = ${money(p / Number(sf[1]))} per sf` };
    }
    case "corner-bead":
      return u === "ea" || u === "" || u === "pc" ? { price: p, how: `${per} piece` } : none(`bead per ${row.unit}`);
  }
  return our ? none("no conversion") : none("not a material the estimate counts");
}

/** One row read: its material, and its price in the estimate's unit. */
export function readRow(row: { line: number; cells: string[] }, map: ColumnMap, rollLf: number): ReadRow {
  const cell = (i: number | null) => (i === null ? "" : (row.cells[i] ?? "").trim());
  const description = [cell(map.item), cell(map.size)].filter(Boolean).join(" ").replace(/\s+/g, " ");
  const unit = cell(map.unit) || null;
  const price = priceFrom(cell(map.price));
  const key = materialKey(description);
  const base = { line: row.line, description, unit, price, key, ourUnit: key ? (CANONICAL_UNIT[key.split("|")[0]] ?? null) : null, studLengthFt: key?.startsWith("stud|") ? feetIn(description) : null };
  if (price === null) return { ...base, ourPrice: null, how: "no price on this row" };
  if (key === null) return { ...base, ourPrice: null, how: "not a material the estimate counts" };
  const c = convert({ description, unit, price }, key, rollLf);
  return { ...base, ourPrice: c.price === null ? null : Math.round(c.price * 100) / 100, how: c.how };
}

/** A material the estimate needs a price for: a wall-type part with no catalog entry, read by `materialGroup`. */
export type Need = { group: string; label: string; unit: string | null };

export type Plan = {
  rows: ReadRow[];
  /** Rows that price a material on their own: one row for the material, converted. */
  matched: { key: string; ourUnit: string; line: number }[];
  /** Materials several rows offer, or a stud a length was stated for: a person picks the row. */
  choose: { key: string; ourUnit: string; lines: number[]; why: string }[];
  /** Materials the estimate needs whose words are less precise than any row (no gauge, no R-value): a person picks. */
  needsPick: { group: string; label: string; unit: string | null; lines: number[] }[];
  /** Rows kept for reference only, with why. */
  reference: { line: number; why: string }[];
};

/** A key the estimate wrote with `?` (gauge not on the drawing) is satisfied by any row agreeing on every part it does state. */
function compatible(need: string, row: string): boolean {
  const a = need.split("|");
  const b = row.split("|");
  return a.length === b.length && a.every((part, i) => part === "?" || part === b[i]);
}

export function planPriceList(rows: ReadRow[], needs: readonly Need[]): Plan {
  const priced = rows.filter((r) => r.key !== null && r.ourPrice !== null && !r.key.includes("?"));
  const byKey = new Map<string, ReadRow[]>();
  for (const r of priced) byKey.set(r.key!, [...(byKey.get(r.key!) ?? []), r]);
  const plan: Plan = { rows, matched: [], choose: [], needsPick: [], reference: [] };
  for (const [key, group] of byKey) {
    const ourUnit = group[0].ourUnit!;
    if (group.length === 1 && group[0].studLengthFt === null) plan.matched.push({ key, ourUnit, line: group[0].line });
    else
      plan.choose.push({
        key,
        ourUnit,
        lines: group.map((r) => r.line),
        why: group.some((r) => r.studLengthFt !== null) ? "studs are priced by length — pick the length your walls need" : `${group.length} rows offer this material — pick the one you buy`,
      });
  }
  for (const r of rows) if (!priced.includes(r)) plan.reference.push({ line: r.line, why: r.key?.includes("?") ? "the row does not say enough to know which material (a gauge, an R-value)" : r.how });
  for (const n of needs) {
    const key = materialKey(partOf(n.label));
    if (key === null || !key.includes("?")) continue;
    const lines = priced.filter((r) => compatible(key, r.key!) && sameUnit(r.ourUnit) === sameUnit(n.unit)).map((r) => r.line);
    if (lines.length > 0) plan.needsPick.push({ group: n.group, label: n.label, unit: n.unit, lines });
  }
  return plan;
}

/** What a person decided in the preview: a row for each material with several, and for each imprecise need. */
export type Picks = { byKey: Record<string, number>; byGroup: Record<string, number> };

/** The rows that become catalog prices: every matched row, plus the picked row of each choice. Picks are checked against the plan. */
export function chosenRows(plan: Plan, picks: Picks): { key: string; line: number }[] | string {
  const out = plan.matched.map((m) => ({ key: m.key, line: m.line }));
  for (const [key, line] of Object.entries(picks.byKey)) {
    const choice = plan.choose.find((c) => c.key === key);
    if (!choice || !choice.lines.includes(line)) return `Row ${line} is not one of the choices for that material — reload and pick again.`;
    out.push({ key, line });
  }
  for (const [group, line] of Object.entries(picks.byGroup)) {
    const need = plan.needsPick.find((n) => n.group === group);
    if (!need || !need.lines.includes(line)) return `Row ${line} does not fit "${group}" — reload and pick again.`;
  }
  return out;
}

/** The catalog wording for a material a price list priced, so it reads like the estimate's own lines. */
export function materialLabelFor(key: string, rollLf: number): string {
  const [kind, a, b, c] = key.split("|");
  const inches = (s: string) => {
    const n = Number(s);
    const whole = Math.floor(n);
    const frac = n - whole;
    const eighths = Math.round(frac * 16);
    if (eighths === 0) return `${whole}in`;
    const [nu, de] = eighths % 8 === 0 ? [eighths / 8, 2] : eighths % 4 === 0 ? [eighths / 4, 4] : eighths % 2 === 0 ? [eighths / 2, 8] : [eighths, 16];
    return whole === 0 ? `${nu}/${de}in` : `${whole}-${nu}/${de}in`;
  };
  switch (kind) {
    case "board":
      return `${inches(a)} ${b === "regular" ? "" : `${b.replace("x", "type X").replace("mr", "moisture-resistant").replace(/\+/g, " ")} `}gypsum board, 4x8 sheets`;
    case "stud":
      return `${inches(b)} metal stud, ${c} ga`;
    case "track":
      return `${inches(a)} track, ${b} ga`;
    case "deflection":
      return `${inches(a)} deflection track, ${b} ga`;
    case "screws":
      return "drywall screws, Type S, per 1,000";
    case "tape":
      return `joint tape, ${rollLf} ft rolls`;
    case "compound":
      return "joint compound";
    case "insulation":
      return `cavity insulation${a === "?" ? "" : `, ${a.toUpperCase().replace("R", "R-")}`}`;
    case "corner-bead":
      return "corner bead";
  }
  return key;
}

