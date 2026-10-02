import type { SheetSpec, SymbolSpec } from "./syntheticSheet";

/**
 * THE CASES THE SYMBOL-COUNTING QUESTION IS ASKED WITH.
 *
 * Every sheet is synthetic (`syntheticSheet.ts`) because the standing rule here
 * is **"Never use real customer files in tests or fixtures"** and a GC's drawing
 * set is precisely the confidential document that rule is about. The useful
 * side-effect: the truth is exact, because this file placed every symbol.
 *
 * ── PAIRED ARMS, AND THE PAIRING IS THE WHOLE DESIGN ──
 *
 * Each case appears TWICE with identical symbols — once on an ARCH D sheet
 * (~44 DPI once a vision tier fits it) and once on a letter-size detail sheet
 * (~143 DPI). `planPdf.ts` measured that constraint for the title-block work and
 * it is the reason this question is hard rather than merely unanswered.
 *
 * A single-arm eval could only ever report "symbol counting works" or "symbol
 * counting does not work", and the second of those conflates two findings that
 * point in opposite directions:
 *
 *   fails ARCH_D, passes DETAIL  -> the capability is there and the FEATURE
 *                                   needs tiling. Expensive, and buildable.
 *   fails both                   -> the capability is not there. Kills the
 *                                   feature and saves the tiling work.
 *
 * Reporting the first as the second is how a project spends a month building a
 * rasteriser for a model that could never have counted anyway. This file exists
 * so that cannot happen.
 *
 * ── WHAT THESE CASES ARE NOT ──
 *
 * Clean, digitally generated geometry on an otherwise empty sheet, bounded
 * exactly as the title-block eval bounds itself. A real drawing has hatching,
 * dimension strings, overlapping notes, xrefs and a scanner's noise. **A pass
 * here is a FLOOR, not a forecast** — it says the model can count marks it can
 * see. A failure here is much stronger evidence, because it means the model
 * cannot count even in the easiest world that could be built for it.
 */

export type SymbolCase = {
  id: string;
  /** What the eval asks for, in the words a drawing would use. */
  ask: string;
  looksLike: string;
  kind: SymbolSpec["kind"];
  count: number;
  /** Why this case is here, printed in the report so a reader knows what a
   *  failure on it costs. */
  why: string;
};

const CASES: SymbolCase[] = [
  {
    id: "bubbles-6",
    ask: "column grid bubbles",
    looksLike: "Each one is a circle with a single letter inside it.",
    kind: "columnBubble",
    count: 6,
    why: "the easiest possible count — few, large, distinct. A failure here ends the question.",
  },
  {
    id: "bubbles-23",
    ask: "column grid bubbles",
    looksLike: "Each one is a circle with a single letter inside it.",
    kind: "columnBubble",
    count: 23,
    why: "a count no one can eyeball, and not a round number — a model estimating from density lands on 20 or 25.",
  },
  {
    id: "doors-11",
    ask: "doors",
    looksLike: "Each one is drawn as a straight leaf line with a quarter-circle swing arc.",
    kind: "door",
    count: 11,
    why: "a symbol made of two thin strokes rather than a filled shape — the line-weight case, and what an opening actually looks like.",
  },
  {
    id: "wallTags-17",
    ask: "wall type tags",
    looksLike: "Each one is a small filled square with a number printed beside it.",
    kind: "wallTag",
    count: 17,
    why: "the smallest symbol, and the one whose meaning depends on text a 44-DPI image cannot resolve.",
  },
];

/** Every case, on both sheet sizes — the paired arms. */
export const SYMBOL_CASES: (SymbolCase & { sheet: SheetSpec })[] = CASES.flatMap((one) => [
  {
    ...one,
    id: `${one.id}@ARCH_D`,
    sheet: {
      id: `${one.id}-arch-d`,
      sheetSize: "ARCH_D" as const,
      sheetNumber: "A-201",
      symbols: [{ kind: one.kind, count: one.count }],
    },
  },
  {
    ...one,
    id: `${one.id}@DETAIL`,
    sheet: {
      id: `${one.id}-detail`,
      sheetSize: "DETAIL" as const,
      sheetNumber: "A-501",
      symbols: [{ kind: one.kind, count: one.count }],
    },
  },
]);
