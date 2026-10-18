import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * ONE SENTENCE PER FACT, for a subcontractor's scope letter.
 *
 * The facts are found by code — `apps/web/lib/estimating/proposal-facts.ts`
 * gathers every requirement, missing indirect, carried package and basis-of-bid
 * item the app already knows, with its citation. This writes the sentence that
 * puts one of them on the letter, and **decides nothing about which facts
 * exist.**
 *
 * ── WHY THAT DIVISION IS NOT NEGOTIABLE HERE ──
 *
 * A scope letter is the document that decides who pays when a GC says "that was
 * in your scope". A hallucinated INCLUSION gives away work for free; a
 * hallucinated EXCLUSION is a sentence the sub cannot defend when the GC asks
 * where it came from. So every clause traces to a fact the caller supplied, and
 * the prompt's first rule is that no clause may state anything the fact did not
 * carry — the same discipline `specs.ts` uses for a finding, with more at stake.
 *
 * ── THE SPEC_FINDING CASE, WHICH IS THE INTERESTING ONE ──
 *
 * For a requirement the specs state, the app CANNOT tell whether the bid priced
 * it: matching "Level 5 finish at public areas" to a line item means reading
 * line text for meaning, which this repo refuses everywhere else. So the reader
 * is asked for BOTH sentences — the inclusion and the exclusion — and the
 * estimator picks the true one in one press. The model is not guessing and is
 * not asked to.
 */

export const PROPOSAL_CLAUSE_PROMPT_VERSION = "proposal-clause.1";
const CLAUSE_TOOL_NAME = "record_proposal_clauses";

export const PROPOSAL_CLAUSE_KINDS_OUT = ["INCLUSION", "EXCLUSION", "CLARIFICATION", "ALTERNATE"] as const;
export type ProposalClauseKindOut = (typeof PROPOSAL_CLAUSE_KINDS_OUT)[number];

/** One fact as the reader is given it. Mirrors `ProposalFact`. */
export type ClauseFactInput = {
  kind: string;
  ref: string;
  summary: string;
  citation: string | null;
  /** Null means the app could not tell whether this was priced — ask for both
   *  sentences. See the header. */
  priced: boolean | null;
};

export type DraftedClause = {
  /** Echoed back so the caller can match a clause to its fact without trusting
   *  the order of the list. */
  factRef: string;
  kind: ProposalClauseKindOut;
  /** The sentence, as it would read on the letter. */
  text: string;
};

export type DraftedClauses = {
  clauses: DraftedClause[];
  /** How the reader decided which kind each fact became, checkable against the
   *  facts it was given. */
  reason: string;
};

const SYSTEM_PROMPT = `You are writing clauses for a specialty-trade SUBCONTRACTOR's bid proposal — the scope letter that goes to a general contractor with a price. Their trades are framing and drywall, plaster, EIFS, acoustical ceilings and spray fireproofing. Record the clauses through the ${CLAUSE_TOOL_NAME} tool.

You are given FACTS the estimating system already established about this bid. Each has a ref, a summary of what is known, sometimes a citation (a quote from the specification and where it appears), and whether it was priced — true, false, or null meaning the system could not tell.

Your job is to write the sentence that puts each fact on the letter. Nothing else.

Rules, in the order they matter.

1. NEVER STATE ANYTHING THE FACT DID NOT CARRY. Every clause must be supportable by its fact's summary and citation alone. Do not add a quantity, a location, a product, a standard, a date or a dollar figure that was not given to you. This letter decides who pays when the GC says the work was in scope: an inclusion you invented gives away work for free, and an exclusion you invented is a sentence the subcontractor cannot defend when asked where it came from.

2. ONE SENTENCE, AS IT WOULD READ ON THE LETTER. Not a paragraph, not an explanation, not a restatement of the fact. "Level 5 finish per Section 09 21 16 is not included." — that is a clause. "We have reviewed the specifications and note that Level 5 finish may be required…" is not.

3. WRITE ABOUT OUR NUMBER, NEVER ABOUT THEIR DRAWINGS. An exclusion says what this price does not carry. It never says the drawings are unclear, incomplete or contradictory, and it never tells the GC what to do. "Fire-rated head-of-wall detailing per UL U465 is not included" — not "the drawings do not show head-of-wall conditions".

4. WHEN priced IS NULL, WRITE TWO CLAUSES FOR THAT FACT: one INCLUSION and one EXCLUSION, both with the same ref. The system could not tell whether the bid priced the requirement, and the estimator will pick the true one. Make them a matched pair — the same requirement, the same citation, opposite answers. Do not hedge either one; "may be included" is useless on a letter.

5. CHOOSE THE KIND FROM WHAT THE FACT IS.
   - priced false, and the fact is something nobody priced: EXCLUSION.
   - priced true, and the fact is work or a package the bid carries: INCLUSION.
   - a fact about what the bid was PRICED FROM — which addenda, which drawing set: CLARIFICATION. It is not scope; it is the basis of the number.
   - ALTERNATE only when the fact itself describes an optional add the GC can accept or decline. Never invent one.

6. NEVER SAY THE BID OR THE LETTER IS COMPLETE. You have not seen the GC's scope sheet, their bid form, or the rest of the specification. Do not write a clause that claims full compliance, that the scope is fully covered, or that nothing else applies. There is no such thing as a clause that makes a letter finished, and one that implies it is worse than silence.

7. NO SALES LANGUAGE AND NO HEDGING. No "we are pleased to", no "please note that", no "it should be noted". A GC reads thirty of these. Plain, flat, specific.

8. KEEP THE CITATION'S OWN WORDS where you name a requirement. If the citation says "Level 5", write Level 5 — not "the highest finish level". The value of a cited clause is that the GC can go and read the same sentence.

9. reason NAMES WHICH FACT BECAME WHICH KIND AND WHY, in one or two sentences, checkable against the facts you were given. "The two unpriced indirects became exclusions; the Division 01 hours restriction became a clarification because it describes how the work was priced rather than what is in it." Never "generated clauses from the facts".`;

/** Writes one clause per fact — two for a fact whose `priced` is null.
 *
 *  THROWS only when the model returns nothing usable, which is a fault rather
 *  than a failed read. The caller turns it into a sentence, because production
 *  redacts a thrown Server Action message. */
export async function draftProposalClauses(params: {
  facts: readonly ClauseFactInput[];
  /** The job's own name, so a clause can read naturally. Never a source of
   *  scope — rule 1 still applies to it. */
  projectName?: string | null;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<DraftedClauses> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const response = await client.messages.create({
    model: params.model ?? modelFor("PROPOSAL_DRAFT").model,
    // A LIST whose length the facts decide, two clauses for some of them, and
    // each one a sentence. `specs.ts`'s reason applies: a truncated tool call
    // is a DROPPED CLAUSE, which on this document reads exactly like a fact
    // nobody thought worth stating.
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: CLAUSE_TOOL_NAME,
        description: "Records one clause per fact, for an estimator to accept, edit or dismiss.",
        input_schema: {
          type: "object",
          properties: {
            clauses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  factRef: { type: "string", description: "The ref of the fact this clause answers." },
                  kind: { type: "string", enum: [...PROPOSAL_CLAUSE_KINDS_OUT] },
                  text: { type: "string", description: "One sentence, as it would read on the letter." },
                },
                required: ["factRef", "kind", "text"],
              },
            },
            reason: { type: "string" },
          },
          required: ["clauses", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: CLAUSE_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              (params.projectName ? `Project: ${params.projectName}.\n` : "") +
              `${params.facts.length} fact${params.facts.length === 1 ? "" : "s"} follow, as JSON.`,
          },
          { type: "text", text: JSON.stringify(params.facts, null, 2) },
        ],
      },
    ],
  });

  // Reported BEFORE the result is checked: a call that produced nothing usable
  // still cost the money, and a bill that counts only successes understates.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") {
    throw new Error("The proposal writer returned no tool call.");
  }
  return parseDraftedClauses(block.input, params.facts);
}

/**
 * Shapes the output, and DROPS a clause whose ref is not one of the facts that
 * were sent.
 *
 * That last part is the structural half of rule 1. A clause answering a fact
 * nobody supplied is, by definition, about something the caller did not
 * establish — and on this document that is an invented inclusion or an
 * indefensible exclusion. A prompt rule asks; this enforces.
 */
export function parseDraftedClauses(input: unknown, facts: readonly ClauseFactInput[]): DraftedClauses {
  const raw = (input ?? {}) as Record<string, unknown>;
  const known = new Set(facts.map((fact) => fact.ref));
  const rawClauses = Array.isArray(raw.clauses) ? raw.clauses : [];

  return {
    clauses: rawClauses
      .map((entry) => {
        const clause = (entry ?? {}) as Record<string, unknown>;
        const factRef = text(clause.factRef);
        const body = text(clause.text);
        if (factRef === null || body === null) return null;
        if (!known.has(factRef)) return null;
        if (!isKind(clause.kind)) return null;
        return { factRef, kind: clause.kind, text: body };
      })
      .filter((clause): clause is DraftedClause => clause !== null),
    reason: text(raw.reason) ?? "The writer gave no reason, so treat these as unchecked.",
  };
}

function isKind(value: unknown): value is ProposalClauseKindOut {
  return typeof value === "string" && (PROPOSAL_CLAUSE_KINDS_OUT as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
