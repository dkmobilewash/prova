import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * ── WHAT A TRADE SECTION SPECIFIES, AS FACTS A WALL TYPE CAN BE CHECKED AGAINST ──
 *
 * `specs.ts` reads a section for what COSTS money, as free-text findings. This reads
 * the same kind of section for what it SPECIFIES — stud gauge and spacing, board type
 * and thickness, fire ratings, ceiling tile and grid, finish levels, named products —
 * so code can lay each fact beside the wall legend's own words and say where they
 * disagree. It also lists the price drivers (Level 5, abuse-resistant board,
 * deflection track) so the estimator can carry them onto the proposal.
 *
 * TEXT IN, like the legend reader, not the PDF: a spec book carries a text layer
 * (a scanned one is refused before it gets here), and a section is 5–40 pages of
 * prose, so text is a fraction of the cost of the document and loses nothing.
 *
 * VALUES ARE AS PRINTED. "20 gauge (33 mil)", "16 inches on center", "5/8 inch".
 * The app parses numbers out of those words (`lib/specs/specTradeFacts.ts`), tested,
 * exactly as `partitionAssembly.ts` parses the legend's — the model's reading of a
 * number is not trusted, its copying of a phrase is checkable.
 *
 * EVERY FACT CARRIES ITS QUOTE, and the app drops any fact whose quote is not in the
 * section's text (`quoteMatch.ts`), the spec eval's rule.
 */

/** Stored on every `SpecTradeReading`. */
export const SPEC_TRADE_PROMPT_VERSION = "spec-trade.1";

type Quoted = { quote: string };
export type SpecProduct = Quoted & { manufacturer: string; product: string | null };
export type SpecStud = Quoted & { gauge: string | null; depth: string | null; spacing: string | null };
export type SpecBoard = Quoted & { kind: string; thickness: string | null; where: string | null };
export type SpecFireRating = Quoted & { rating: string; assembly: string | null };
export type SpecCeiling = Quoted & { tile: string | null; grid: string | null };
export type SpecFinishLevel = Quoted & { level: number; where: string | null };
export type SpecPriceDriver = Quoted & { label: string; why: string };

export type SpecTradeRead = {
  products: SpecProduct[];
  studs: SpecStud[];
  boards: SpecBoard[];
  fireRatings: SpecFireRating[];
  ceilings: SpecCeiling[];
  finishLevels: SpecFinishLevel[];
  priceDrivers: SpecPriceDriver[];
  reason: string;
};

const TOOL_NAME = "record_spec_facts";

const SYSTEM_PROMPT = `You are reading one section of a construction specification for a specialty-trade SUBCONTRACTOR (framing and drywall, plaster and EIFS, acoustical ceilings, spray fireproofing) who is about to bid. You get the section's text, page by page. Record what it SPECIFIES through the ${TOOL_NAME} tool.

1. COPY, DO NOT COMPUTE. Every value is the section's own words: gauge "20 gauge (33 mil)", spacing "16 inches on center maximum", thickness "5/8 inch". Do not convert units, do not round, do not tidy. Code reads the numbers from your words.

2. EVERY ITEM CARRIES ITS QUOTE: the sentence or clause you read it from, copied exactly from the text. If you cannot quote it, leave it out. An item whose quote is not in the text is thrown away.

3. ONLY WHAT THE SECTION STATES. Never fill in a typical value, a code minimum or what the drawings probably show. An empty list is a real answer.

4. studs: steel or wood studs this section specifies — gauge (or mils), depth, maximum spacing. Track and furring only if a gauge or spacing is given for them.
   boards: each board product — kind ("Type X", "abuse-resistant", "impact-resistant", "moisture-resistant", "mold-resistant", "shaftliner", "regular", "cement board", as the section names it), thickness, and where it goes if the section says.
   fireRatings: each rating with its tested assembly (UL, GA, Intertek) if named.
   ceilings: tile or panel (size, material, product) and grid (width, product).
   finishLevels: each gypsum board finish level (0–5) as an integer, and where it applies.
   products: each named manufacturer, with the product if named. One item per manufacturer.

5. priceDrivers: what in this section costs more than an ordinary bid for this trade carries, in the subcontractor's words — Level 5 finish, abuse- or impact-resistant board, deflection track or slotted head, a tighter deflection limit (L/360), heavier studs than 25 gauge, closer spacing than 24 inches, a sole-sourced product or "no substitutions", a mock-up, third-party inspection, attic stock, seismic bracing. label is short ("Level 5 at lobby"); why is one checkable line. Never say whether their bid carries it — you have not seen it.

6. reason: one or two sentences on what the section covered and anything you could not read.`;

const quoted = { quote: { type: "string" } } as const;

export async function extractSpecTrade(params: {
  sectionNumber: string;
  title: string | null;
  /** The section's pages, each as its lines in reading order. */
  pages: readonly { page: number; lines: readonly string[] }[];
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<SpecTradeRead> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const body = params.pages.map((p) => `--- page ${p.page} ---\n${p.lines.join("\n")}`).join("\n\n");
  const str = { type: "string" } as const;
  const strOrNull = { type: ["string", "null"] } as const;
  const list = (properties: Record<string, unknown>, required: string[]) => ({
    type: "array",
    items: { type: "object", properties: { ...properties, ...quoted }, required: [...required, "quote"] },
  });
  const response = await client.messages.create({
    model: params.model ?? modelFor("PLAN_TEXT_READ").model,
    // A list whose length the section decides: a truncated call drops the last items,
    // which reads as a section that never specified them (`specs.ts`'s reason).
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Records what a specification section specifies, each item with the words it was read from.",
        input_schema: {
          type: "object",
          properties: {
            products: list({ manufacturer: str, product: strOrNull }, ["manufacturer", "product"]),
            studs: list({ gauge: strOrNull, depth: strOrNull, spacing: strOrNull }, ["gauge", "depth", "spacing"]),
            boards: list({ kind: str, thickness: strOrNull, where: strOrNull }, ["kind", "thickness", "where"]),
            fireRatings: list({ rating: str, assembly: strOrNull }, ["rating", "assembly"]),
            ceilings: list({ tile: strOrNull, grid: strOrNull }, ["tile", "grid"]),
            finishLevels: list({ level: { type: "integer", minimum: 0, maximum: 5 }, where: strOrNull }, ["level", "where"]),
            priceDrivers: list({ label: str, why: str }, ["label", "why"]),
            reason: str,
          },
          required: ["products", "studs", "boards", "fireRatings", "ceilings", "finishLevels", "priceDrivers", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `Section ${params.sectionNumber}${params.title ? ` — ${params.title}` : ""}:\n\n${body}`,
      },
    ],
  });

  await reportUsage(params.onUsage, response.usage);
  const block = response.content.find((one) => one.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") throw new Error("The model returned no spec reading.");
  return specTradeReadFrom(block.input);
}

/**
 * The tool's input into a read, keeping only well-formed items: a missing quote, a
 * blank required value or a finish level outside 0–5 drops the item rather than
 * storing a half-fact. Exported so the shape asked for and the shape read are tested
 * against each other without a call.
 */
export function specTradeReadFrom(input: unknown): SpecTradeRead {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const items = <T>(key: string, build: (o: Record<string, unknown>, quote: string) => T | null): T[] =>
    (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []).flatMap((one) => {
      const o = (one ?? {}) as Record<string, unknown>;
      const quote = text(o.quote);
      if (quote === null) return [];
      const built = build(o, quote);
      return built === null ? [] : [built];
    });
  return {
    products: items("products", (o, quote) => {
      const manufacturer = text(o.manufacturer);
      return manufacturer === null ? null : { manufacturer, product: text(o.product), quote };
    }),
    studs: items("studs", (o, quote) => {
      const stud = { gauge: text(o.gauge), depth: text(o.depth), spacing: text(o.spacing), quote };
      return stud.gauge === null && stud.depth === null && stud.spacing === null ? null : stud;
    }),
    boards: items("boards", (o, quote) => {
      const kind = text(o.kind);
      return kind === null ? null : { kind, thickness: text(o.thickness), where: text(o.where), quote };
    }),
    fireRatings: items("fireRatings", (o, quote) => {
      const rating = text(o.rating);
      return rating === null ? null : { rating, assembly: text(o.assembly), quote };
    }),
    ceilings: items("ceilings", (o, quote) => {
      const ceiling = { tile: text(o.tile), grid: text(o.grid), quote };
      return ceiling.tile === null && ceiling.grid === null ? null : ceiling;
    }),
    finishLevels: items("finishLevels", (o, quote) => {
      const level = typeof o.level === "number" && Number.isInteger(o.level) && o.level >= 0 && o.level <= 5 ? o.level : null;
      return level === null ? null : { level, where: text(o.where), quote };
    }),
    priceDrivers: items("priceDrivers", (o, quote) => {
      const label = text(o.label);
      const why = text(o.why);
      return label === null || why === null ? null : { label, why, quote };
    }),
    reason: text(raw.reason) ?? "",
  };
}
