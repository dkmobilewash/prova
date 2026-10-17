import { createHash } from "node:crypto";
import type { SubcontractFindingCategory } from "@prova/integrations/src/subcontractReview";
import { normaliseForQuoteMatch } from "@/lib/specs/quoteMatch";

/**
 * THE STABLE KEY: `CATEGORY:` + 16 hex of the SHA-1 of the normalised quote.
 *
 * Normalised with `quoteMatch.ts`'s own function, so two runs that quote the
 * same clause with a curly versus a straight apostrophe produce one key — the
 * same equivalence the citation check already accepts. The key is what a
 * decision hangs on (`SubcontractFindingDecision @@unique([jobId, key])`), so it
 * must be identical across re-runs and across contract versions whose clause is
 * word-for-word unchanged, and it must CHANGE when one word of the clause does.
 */
export function findingKey(category: SubcontractFindingCategory, quote: string): string {
  const digest = createHash("sha1").update(normaliseForQuoteMatch(quote)).digest("hex").slice(0, 16);
  return `${category}:${digest}`;
}
