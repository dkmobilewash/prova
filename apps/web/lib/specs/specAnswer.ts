import type { SpecBoard, SpecCeiling, SpecFinishLevel, SpecFireRating, SpecPriceDriver, SpecProduct, SpecStud } from "@prova/integrations/src/specTrade";
import { gaugeFrom, specSays, spacingFrom, type SectionFacts } from "./specTradeFacts";

/**
 * ── WHAT A JOB'S SPEC SAYS, FOR ASK: read-only, every item with where it came from ──
 *
 * Built from the same reads the Specs page shows — a spec book's sections and the notes printed on
 * the drawings (`loadJobSpecFacts`) — so Ask cannot say something the page does not. Numbers are the
 * code's (`specTradeFacts.ts`), never the model's. "Not in my estimate" is a match by WORDS on the
 * estimate's line descriptions, and the answer says so: a line carrying an item under another name is
 * not seen, and nothing here knows what a line costs.
 */
export const SPEC_TOPICS = ["board", "studs", "finish_level", "ceilings", "fire_rating", "products", "price_items", "not_in_estimate", "all"] as const;
export type SpecTopic = (typeof SPEC_TOPICS)[number];

export function asSpecTopic(value: unknown): SpecTopic {
  return typeof value === "string" && (SPEC_TOPICS as readonly string[]).includes(value) ? (value as SpecTopic) : "all";
}

const short = (quote: string) => (quote.length > 220 ? `${quote.slice(0, 217)}…` : quote);

/** Which words on an estimate line would carry a price item. Null when no line could (a "no substitutions"). */
export function estimateWords(item: string): RegExp | null {
  if (/type\s*['"]?\s*x/i.test(item)) return /type\s*['"]?\s*x|fire[-\s]?rated\s+(?:gyp|board)/i;
  if (/abuse|impact/i.test(item)) return /abuse|impact/i;
  if (/level\s*5/i.test(item)) return /level\s*5|skim\s*coat/i;
  const gauge = item.match(/\b(\d{2})\s*ga\b/i);
  if (gauge) {
    // A line at that gauge or heavier carries it: 20 ga is met by 20, 18, 16…
    const g = Number(gauge[1]);
    return new RegExp(`\\b(${[12, 14, 16, 18, 20, 22].filter((n) => n <= g).join("|")})\\s*(?:ga|gauge|gage)\\b`, "i");
  }
  if (/deflection|slotted|slip\s*track/i.test(item)) return /deflection|slotted|slip\s*track|deep[-\s]?leg/i;
  if (/attic|owner'?s\s*stock/i.test(item)) return /attic|owner'?s\s*stock|extra\s+(?:stock|material)/i;
  if (/mock[-\s]?up/i.test(item)) return /mock[-\s]?up/i;
  if (/seismic|bracing/i.test(item)) return /seismic|bracing|splay|compression\s*strut/i;
  if (/moisture|mold|water[-\s]?resistant/i.test(item)) return /moisture|mold|water[-\s]?resistant|\bmr\b/i;
  if (/no\s+substitution/i.test(item)) return null;
  const word = item.toLowerCase().match(/\b[a-z]{5,}\b/)?.[0];
  return word ? new RegExp(`\\b${word}`, "i") : null;
}

export function specAnswer(facts: readonly SectionFacts[], topic: SpecTopic, estimateLines: readonly { description: string }[]) {
  const pick = <T extends { quote: string }, R extends object>(
    key: "boards" | "studs" | "fireRatings" | "ceilings" | "finishLevels" | "products" | "priceDrivers",
    shape: (item: T) => R,
  ): (R & { source: string; quote: string })[] =>
    facts.flatMap(({ sectionNumber: source, read }) => (read[key] as unknown as T[]).map((item) => ({ ...shape(item), source, quote: short(item.quote) })));

  const board = () => pick("boards", (b: SpecBoard) => ({ kind: b.kind, thickness: b.thickness, where: b.where }));
  const studs = () => {
    const rows = pick("studs", (s: SpecStud) => ({ gauge: s.gauge, depth: s.depth, spacing: s.spacing }));
    const gauges = facts.flatMap((f) => f.read.studs.map((s) => (s.gauge === null ? null : gaugeFrom(s.gauge)))).filter((n): n is number => n !== null);
    const spacings = facts.flatMap((f) => f.read.studs.map((s) => (s.spacing === null ? null : spacingFrom(s.spacing)))).filter((n): n is number => n !== null);
    // The lightest gauge any source allows is the spec's minimum; read by code from the printed words.
    return { studs: rows, lightestGaugeAllowed: gauges.length > 0 ? Math.max(...gauges) : null, widestSpacingAllowedInches: spacings.length > 0 ? Math.max(...spacings) : null };
  };
  const finish = () => {
    const rows = pick("finishLevels", (f: SpecFinishLevel) => ({ level: f.level, where: f.where }));
    return { finishLevels: rows, level5Anywhere: rows.some((r) => r.level === 5) };
  };
  const priceItems = () => {
    const says = specSays(null, facts).map((s) => ({ item: s.text, source: s.source }));
    const drivers = pick("priceDrivers", (d: SpecPriceDriver) => ({ item: d.label, why: d.why }));
    const seen = new Set<string>();
    return [...says, ...drivers].filter((p) => {
      const key = `${String(p.item).toLowerCase()}|${p.source}`;
      return !seen.has(key) && seen.add(key) !== undefined;
    });
  };
  const notInEstimate = () => {
    const items = priceItems();
    const lines = estimateLines.map((l) => l.description);
    const onEstimate: { item: string; source: string; line: string }[] = [];
    const notOnEstimate: { item: string; source: string }[] = [];
    for (const p of items) {
      const words = estimateWords(String(p.item));
      if (words === null) continue;
      const line = lines.find((d) => words.test(d));
      if (line) onEstimate.push({ item: String(p.item), source: String(p.source), line });
      else notOnEstimate.push({ item: String(p.item), source: String(p.source) });
    }
    return {
      estimateLineCount: lines.length,
      notOnEstimate,
      onEstimate,
      howMatched:
        "By the words on the estimate's line descriptions only. A line that carries an item under another name is not seen, and this does not know what any line costs — say both.",
    };
  };

  const sources = [...new Set(facts.map((f) => f.sectionNumber))];
  switch (topic) {
    case "board":
      return { sources, board: board() };
    case "studs":
      return { sources, ...studs() };
    case "finish_level":
      return { sources, ...finish() };
    case "ceilings":
      return { sources, ceilings: pick("ceilings", (c: SpecCeiling) => ({ tile: c.tile, grid: c.grid })) };
    case "fire_rating":
      return { sources, fireRatings: pick("fireRatings", (r: SpecFireRating) => ({ rating: r.rating, assembly: r.assembly })) };
    case "products":
      return { sources, products: pick("products", (p: SpecProduct) => ({ manufacturer: p.manufacturer, product: p.product })) };
    case "price_items":
      return { sources, priceItems: priceItems() };
    case "not_in_estimate":
      return { sources, ...notInEstimate() };
    case "all":
      return {
        sources,
        board: board(),
        ...studs(),
        ...finish(),
        fireRatings: pick("fireRatings", (r: SpecFireRating) => ({ rating: r.rating, assembly: r.assembly })),
        priceItems: priceItems(),
        printedRequirements: facts.reduce((n, f) => n + (f.read.requirements?.length ?? 0), 0),
      };
  }
}
