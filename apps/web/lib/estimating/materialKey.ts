import { inchesFrom } from "@/lib/takeoff/partitionAssembly";

/**
 * ── WHICH MATERIAL A LINE IS, READ FROM ITS WORDS ──
 *
 * An assembly part says "5/8in type X gypsum board"; the company's catalog says `5/8" Type X Gypsum
 * Board 4x8`. Both are read into one key — kind, size, the qualities that change the price (Type X,
 * abuse-resistant, gauge) — so a part finds the company's own price without anybody linking it, and the
 * estimate can list each unpriced MATERIAL once rather than every line. Code, never a model; a key that
 * cannot be read is null, and a null never matches anything.
 */
/** SSMA thickness in mils → the gauge it is sold as (18 → 25, 30 and 33 → 20, 43 → 18, 54 → 16, 68 → 14). */
const MIL_TO_GAUGE: Record<string, string> = { "18": "25", "19": "25", "30": "20", "33": "20", "43": "18", "54": "16", "68": "14", "97": "12" };

/** SSMA widths are hundredths, except the eighths the trade rounds: 362 is 3-5/8, 162 is 1-5/8. */
const SSMA_WIDTH: Record<string, number> = { "162": 1.625, "250": 2.5, "350": 3.5, "362": 3.625, "400": 4, "550": 5.5, "600": 6, "800": 8, "1000": 10 };

export function materialKey(description: string): string | null {
  const d = description
    .toLowerCase()
    .replace(/[″"]/g, "in")
    .replace(/\s+/g, " ")
    // A track's LEG or flange ("2-1/2in leg") is not its width; the width is the other inch figure.
    .replace(/\d[\d\s/-]*in\.?\s*(?:deep\s+|long\s+)?(?:leg|flange)s?\b/g, "leg");
  const size = (text: string | undefined) => {
    if (text === undefined) return "?";
    const n = inchesFrom(text);
    return n === null ? "?" : String(Math.round(n * 1000) / 1000);
  };
  // An SSMA designation names width and thickness exactly: 362S125-33 is a 3-5/8in stud, 33 mil (20 ga).
  const ssma = d.match(/\b(\d{3})([st])\d{3}-(\d{2,3})\b/);
  const gauge = d.match(/\b(\d{2})\s*(?:ga|gauge|gage)\b/)?.[1] ?? (ssma ? MIL_TO_GAUGE[ssma[3]] : undefined) ?? d.match(/\b(\d{2})\s*mil\b/)?.[1]?.concat("mil") ?? "?";

  if (/\bscrews?\b/.test(d)) return "screws";
  if (/\b(?:joint\s+)?tape\b/.test(d) && !/\bboard\b/.test(d)) return "tape";
  if (/\b(?:joint\s+)?compound\b|\bmud\b/.test(d)) return "compound";
  if (/\bcorner\s+bead\b/.test(d)) return "corner-bead";
  if (/\binsulation\b|\bbatts?\b/.test(d)) {
    const r = d.match(/\br\s*-?\s*(\d+)/)?.[1];
    return `insulation|${r === undefined ? "?" : `r${r}`}`;
  }
  if (/\b(?:gypsum|gyp\.?|gwb|drywall|wallboard)\b/.test(d) && /\bboard\b|\bgwb\b|\bdrywall\b|\bwallboard\b/.test(d)) {
    const t = d.match(/(\d+(?:\s*-\s*|\s+)?\d*\/\d+|\d+(?:\.\d+)?)\s*(?:in\b|inch)/)?.[1];
    const qualities = [
      /\btype\s*x\b|\bfire[-\s]?rated\b|\bfirecode\b|\bfire[-\s]?shield\b/.test(d) ? "x" : "",
      /\babuse\b/.test(d) ? "abuse" : "",
      /\bimpact\b/.test(d) ? "impact" : "",
      /\bmoisture\b|\bmold\b|\bwater[-\s]?resistant\b/.test(d) ? "mr" : "",
    ].filter(Boolean);
    return `board|${size(t)}|${qualities.join("+") || "regular"}`;
  }
  const inches = d.match(/(\d+(?:\s*-\s*|\s+)?\d*\/?\d*)\s*(?:in\b|inch)/)?.[1];
  const width = ssma ? String(SSMA_WIDTH[ssma[1]] ?? Number(ssma[1]) / 100) : size(inches);
  // The gauge is part of the material: a 20 ga track's price is not a 25 ga track's.
  if (/\bdeflection\b|\bslotted\b/.test(d) && /\btrack\b|\brunner\b/.test(d)) return `deflection|${width}|${gauge}`;
  if (/\btrack\b|\brunner\b/.test(d) || ssma?.[2] === "t") return `track|${width}|${gauge}`;
  // A stud with a gauge is steel, whether or not the line says so; "2x4" studs are wood and not this.
  if (/\bstuds?\b/.test(d) && (/\bmetal\b|\bsteel\b|\bmtl\b|\bstl\b/.test(d) || gauge !== "?" || ssma)) return `stud|metal|${width}|${gauge}`;
  return null;
}

/** "5/8in Type X gypsum board", the words a catalog entry is created with for a key. */
export function materialLabel(description: string): string {
  // The part's own words up to any "(… not on the drawing)" note, which describes the job, not the material.
  return description.replace(/\s*\((?:[^)]*)\)\s*/g, " ").replace(/\s+at\s+\d+(?:\.\d+)?in o\.c\.?/i, "").replace(/\s+/g, " ").trim();
}

/** Units that mean the same thing written differently; a price matches only when the units agree. */
export function sameUnit(unit: string | null): string | null {
  if (unit === null) return null;
  const u = unit.toLowerCase().replace(/[.\s]/g, "");
  if (["sf", "sqft", "squarefeet", "squarefoot"].includes(u)) return "sf";
  if (["lf", "linft", "linearfeet", "linearfoot", "lft"].includes(u)) return "lf";
  if (["ea", "each", "pc", "pcs"].includes(u)) return "ea";
  if (["sht", "sheet", "sheets", "sh"].includes(u)) return "sheet";
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return "lb";
  if (["rl", "roll", "rolls"].includes(u)) return "roll";
  if (["msf", "msqft", "mft2"].includes(u)) return "msf";
  if (["mlf", "mlft"].includes(u)) return "mlf";
  if (["m", "thousand", "per1000", "1000"].includes(u)) return "m";
  if (["bx", "box", "boxes", "ctn", "carton", "cs", "case"].includes(u)) return "box";
  if (["bg", "bag", "bags", "bdl", "bundle"].includes(u)) return "bag";
  if (["pail", "pl", "bucket", "bkt"].includes(u)) return "pail";
  return u;
}

/**
 * The company's catalog entry for each material it has priced, keyed `material@unit`. A key two
 * entries share is left out: picking one of them would be choosing a price nobody chose.
 */
export function catalogByMaterial(entries: readonly { id: string; description: string; unit: string | null }[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const e of entries) {
    const key = materialKey(e.description);
    const unit = sameUnit(e.unit);
    if (key === null || unit === null || key.includes("?")) continue;
    const k = `${key}@${unit}`;
    seen.set(k, seen.has(k) ? null : e.id);
  }
  return new Map([...seen].filter((pair): pair is [string, string] => pair[1] !== null));
}

/** The catalog entry a part takes, or null — no match, or a part whose material cannot be read. */
export function catalogFor(catalog: Map<string, string>, part: { description: string; unit: string | null }): string | null {
  const key = materialKey(part.description);
  const unit = sameUnit(part.unit);
  return key === null || unit === null || key.includes("?") ? null : (catalog.get(`${key}@${unit}`) ?? null);
}

export type UnpricedLine = { id: string; description: string; unit: string | null; quantity: number };
export type UnpricedMaterial = { group: string; label: string; unit: string | null; quantity: number; lineIds: string[] };

/** "S6B — 6in metal stud, 25 ga at 24in o.c." → the part's words, without the wall it is for. */
export function partOf(lineDescription: string): string {
  const at = lineDescription.indexOf(" — ");
  return at === -1 ? lineDescription : lineDescription.slice(at + 3);
}

/** Which "price these" row a line belongs to: the same material in the same unit is one row. */
export function materialGroup(line: { description: string; unit: string | null }): string {
  const part = partOf(line.description);
  return `${materialKey(part) ?? materialLabel(part).toLowerCase()}@${sameUnit(line.unit) ?? ""}`;
}

/**
 * ── "PRICE THESE N MATERIALS": each unpriced material once, not every line that uses it ──
 *
 * Six wall types that all take 5/8in Type X board are one price to find, not six blank lines spread
 * down the estimate. Rows keep the order the estimate first meets them.
 */
export function unpricedMaterials(lines: readonly UnpricedLine[]): UnpricedMaterial[] {
  const rows = new Map<string, UnpricedMaterial>();
  for (const line of lines) {
    const group = materialGroup(line);
    const row = rows.get(group);
    if (row) {
      row.quantity += line.quantity;
      row.lineIds.push(line.id);
    } else rows.set(group, { group, label: materialLabel(partOf(line.description)), unit: line.unit, quantity: line.quantity, lineIds: [line.id] });
  }
  return [...rows.values()];
}
