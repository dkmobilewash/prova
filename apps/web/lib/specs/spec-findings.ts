import { isSpecFindingKind, type SpecFindingKind } from "@prova/integrations/src/specs";

/**
 * Ordering and naming the findings of one spec reading.
 *
 * PURE, AND IN `lib/` RATHER THAN IN THE COMPONENT, for the reason
 * `sheetIndex.ts` states about itself: the unit suite runs in
 * `environment: "node"` and cannot render a component, so logic that lives in a
 * `.tsx` is logic no test can reach. The component renders what this decides.
 *
 * NOT FROM THE BARREL. `@prova/integrations/src/specs` directly, the same import
 * style `lib/ai/features.ts` uses and for its reason: twenty-nine test files
 * mock `"@prova/integrations"` PARTIALLY, and any export reached through the
 * barrel must exist in every one of their factories or a test dies on an access
 * it never made. `specs.ts` has no SDK client and no side effect at import.
 */

/** What a finding looks like once it is out of the reading's JSON. */
export type SpecFindingView = {
  ordinal: number;
  kind: SpecFindingKind;
  label: string;
  requirement: string;
  whyItCosts: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  quote: string;
  sourcePageLabel: string | null;
};

/**
 * What each kind is called on screen.
 *
 * A total `Record` over the kinds, so a member added to the enum without a name
 * does not compile — the shape #526 landed for `CostCategory` after a missing
 * member produced a NaN bid total, and `AI_FEATURE_LABEL` follows for refusal
 * sentences. A raw `NAMED_PRODUCT` on screen is the kind of thing a person reads
 * as a bug.
 */
export const SPEC_FINDING_LABEL: Record<SpecFindingKind, string> = {
  FINISH_LEVEL: "Finish level",
  FIRE_RATING: "Fire rating",
  ACOUSTIC: "Acoustic",
  MOCK_UP: "Mock-up",
  TESTING: "Testing",
  NAMED_PRODUCT: "Named product",
  ATTIC_STOCK: "Attic stock",
  PERFORMANCE: "Performance",
  GENERAL: "Other",
};

const CONFIDENCE_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

/**
 * LOWEST CONFIDENCE FIRST, then the document's own order.
 *
 * `DocumentIntakeConfidence` made this choice first and gave the reason: HIGH
 * sorts to the BOTTOM, "which is what makes over-claiming it the expensive
 * mistake". A reader that says HIGH and is wrong has buried its error at the end
 * of a twenty-row list; one that says LOW has put it where somebody will look.
 *
 * COPIES BEFORE SORTING, and tie-breaks on `ordinal`, so the order is TOTAL —
 * `review.ts` does the same and for the same reason: a row that can move under
 * the cursor between renders is a row somebody acts on by accident.
 */
export function sortFindingsForReview(findings: readonly SpecFindingView[]): SpecFindingView[] {
  return [...findings].sort(
    (a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] || a.ordinal - b.ordinal,
  );
}

/**
 * The reading's `findings` JSON, back into something the screen can render.
 *
 * NARROWED ROW BY ROW RATHER THAN CAST, and the kind is the one that matters: a
 * `Json` column is `unknown` as far as the type system is concerned, and a cast
 * would let a row written by an older prompt version — or by a hand-edited
 * database — reach `SPEC_FINDING_LABEL[kind]` as `undefined` and render the word
 * "undefined" on a bid screen. An unrecognised kind becomes `GENERAL`, which is
 * what that member is for.
 *
 * A finding with no quote is DROPPED rather than shown. The quote is what makes
 * the finding checkable, and this feature's whole claim is that a person can
 * verify each line against the page — a finding without one is an assertion with
 * no evidence, which is the shape `intake.prisma` refuses: "a reason nobody can
 * check is a reason nobody can overrule."
 */
export function findingsFromJson(value: unknown): SpecFindingView[] {
  if (!Array.isArray(value)) return [];
  const out: SpecFindingView[] = [];
  value.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>;
    const quote = typeof row.quote === "string" ? row.quote.trim() : "";
    if (quote === "") return;
    out.push({
      ordinal: typeof row.ordinal === "number" ? row.ordinal : index + 1,
      kind: isSpecFindingKind(row.kind) ? row.kind : "GENERAL",
      label: typeof row.label === "string" ? row.label : "",
      requirement: typeof row.requirement === "string" ? row.requirement : "",
      whyItCosts: typeof row.whyItCosts === "string" ? row.whyItCosts : "",
      confidence: row.confidence === "HIGH" || row.confidence === "MEDIUM" ? row.confidence : "LOW",
      quote,
      sourcePageLabel: typeof row.sourcePageLabel === "string" ? row.sourcePageLabel : null,
    });
  });
  return out;
}
