import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * READING A SPEC SECTION FOR WHAT IT COSTS — not for what it says.
 *
 * A GC's invitation arrives with a spec book, and for a framing/drywall/
 * plaster/EIFS/ceilings/fireproofing sub the money is in two or three sections
 * of Division 09. Each is thirty-odd pages of requirements, and the estimator's
 * fear is one sentence buried on page 24 that costs money the bid does not
 * carry: Level 5 where Level 4 was priced, a UL assembly that changes the stud
 * gauge, a field mock-up, "no substitutions" on a product at twice the
 * catalogue's price.
 *
 * ── IT REPORTS WHAT THE SECTION DEMANDS. IT NEVER SAYS WHETHER THE BID
 *    CARRIES IT ──
 *
 * The model is handed the section and nothing else — not the estimate, not the
 * takeoff, not the catalogue, not the bid. So "is this already priced" is a
 * question about numbers it has never seen, and there is deliberately no field
 * for it in the tool below. That is the same objection `ask/commands/
 * estimating.ts` made when it refused `saveBidAddendum` to the assistant —
 * *"whether it changed work you already priced is an estimator's judgement about
 * drawings the assistant has not seen"* — and the same one that killed the
 * addendum reader's first design, where a proposed `affectsPricedScope` was
 * destructive accepted one way and inert accepted the other.
 *
 * ── THE WHOLE FILE GOES TO THE MODEL ──
 *
 * `quotes.ts` and `addenda.ts`'s shape, and right here for its own reason: a
 * spec book handed to a sub is routinely a scan of a printed set, and a scan has
 * no text layer to extract. `plan-ingest` reads text instead, but that is a COST
 * rule about three hundred pages per set rather than a capability — at one
 * section per click there is nothing to save and a scan would simply fail.
 *
 * ── WHY max_tokens IS 8192 AND NOT 1,024 ──
 *
 * `addenda.ts` gives the reason and it is structural rather than generous: the
 * extractors that return ONE record fit in 1,024, and this returns a LIST whose
 * length the document decides. A thirty-page section with a quote and a checkable
 * reason per finding does not fit, and **a truncated tool call is a dropped
 * finding — which reads exactly like a section that did not demand that thing.**
 * That is the failure this feature exists to prevent, arriving through the
 * plumbing.
 */

/** Bumped to `.2` on 2026-10-05: three kinds added, and rules 8/9 changed what
 * the reader will READ at all — Division 00/01 used to come back empty by rule.
 * Stored on every `BidSpecReading` (`actions/specRead.ts`), so a finding from
 * before this date came from a reader that could not have reported a
 * liquidated-damages clause, and a re-read of the same section may legitimately
 * return more than it did. Without the bump that difference looks like the
 * model being inconsistent. */
export const SPEC_SECTION_PROMPT_VERSION = "spec-section.2";

/**
 * THE ONE LIST. The type, the tool schema and the runtime guard all read it.
 *
 * It used to be three hand-written copies — this union, the `kind` enum in the
 * tool schema below, and `SPEC_FINDING_KINDS` two hundred lines down — plus the
 * prompt's rule 5, `SPEC_FINDING_LABEL` in `apps/web/lib/specs/spec-findings.ts`
 * and the `BidSpecFindingKind` enum in `bid-specs.prisma`. Six places, and the
 * only thing tying them together was this comment claiming to mirror the
 * schema. CLAUDE.md names that shape exactly: *"a completeness test proves the
 * SHARED list has every member; it cannot see a consumer that has stopped
 * reading it… nothing is ever missing from a list nobody imports."*
 *
 * Three of the six are now derived rather than guarded, which is strictly
 * better than a census over copies: the type is `(typeof …)[number]`, the tool
 * schema spreads this array, and the guard already did. What CANNOT be derived
 * is the Postgres enum and the on-screen label, so those two keep a census —
 * `specFindingKindCensus.test.ts` — and the prompt keeps rule 5, which is prose
 * a model reads and no type can check.
 *
 * Adding a kind: add it here, add its label, add its sentence to rule 5, add it
 * to `bid-specs.prisma`, and write the migration. The census fails until the
 * schema agrees; the total `Record` fails until the label exists.
 */
export const SPEC_FINDING_KINDS = [
  "FINISH_LEVEL",
  "FIRE_RATING",
  "ACOUSTIC",
  "MOCK_UP",
  "TESTING",
  "NAMED_PRODUCT",
  "ATTIC_STOCK",
  "PERFORMANCE",
  // ── Division 00/01 contract conditions, added 2026-10-05 ──
  // These three cost money the way a schedule costs money: not a line in the
  // takeoff, a term in the contract. See rules 9 and 11 in the prompt.
  "LIQUIDATED_DAMAGES",
  "WORKING_HOURS",
  "WAGE_REQUIREMENT",
  "GENERAL",
] as const;

/** Mirrors `BidSpecFindingKind` in `bid-specs.prisma`, and
 * `specFindingKindCensus.test.ts` is what makes that sentence true. */
export type SpecFindingKind = (typeof SPEC_FINDING_KINDS)[number];

export type SpecFindingExtraction = {
  ordinal: number;
  kind: SpecFindingKind;
  /** Short, scannable — "Level 5 finish at all public areas". */
  label: string;
  /** What the section DEMANDS, in its own terms. */
  requirement: string;
  /** Why it costs, in one line an estimator can act on. */
  whyItCosts: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** The sentence it was read from, so the reason is checkable. */
  quote: string;
  sourcePageLabel: string | null;
};

export type SpecSectionExtraction = {
  /** The section number as printed, or null — never invented. */
  sectionNumber: string | null;
  title: string | null;
  findings: SpecFindingExtraction[];
  /** How the reader read the document, checkable against it. */
  readingReason: string;
};

const SPEC_TOOL_NAME = "record_spec_costs";

const SPEC_TOOL: Anthropic.Tool = {
  name: SPEC_TOOL_NAME,
  description: "Record what this specification section demands that costs a subcontractor money.",
  input_schema: {
    type: "object",
    properties: {
      sectionNumber: {
        type: ["string", "null"],
        description: 'The section number as PRINTED — "09 21 16". Null if the document does not state one.',
      },
      title: { type: ["string", "null"], description: "The section's own title. Null if not stated." },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ordinal: { type: "integer", description: "Your own 1-based ordering." },
            // SPREAD, never a second list: a kind the type admits and the tool
            // schema does not is a finding the model cannot report, and nothing
            // would have failed — the model would simply never use it.
            kind: { type: "string", enum: [...SPEC_FINDING_KINDS] },
            label: { type: "string", description: "Short and scannable." },
            requirement: { type: "string", description: "What the section demands, in its own terms." },
            whyItCosts: { type: "string", description: "Why it costs money, in one line." },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            quote: { type: "string", description: "The sentence you read this from, copied." },
            sourcePageLabel: { type: ["string", "null"], description: "Where to look, as the document labels it." },
          },
          // EVERY FIELD REQUIRED, including the nullable ones — `quotes.ts`,
          // `addenda.ts` and `anthropic.ts` all use this shape and give the
          // reason: a model that may omit a key returns `undefined`, and
          // `undefined` and `null` then mean two different things to the caller,
          // "not read" against "not in the document", a distinction nothing
          // downstream wants to carry.
          required: [
            "ordinal",
            "kind",
            "label",
            "requirement",
            "whyItCosts",
            "confidence",
            "quote",
            "sourcePageLabel",
          ],
        },
      },
      readingReason: { type: "string", description: "How you read the document, in one or two sentences." },
    },
    required: ["sectionNumber", "title", "findings", "readingReason"],
  },
};

const SPEC_SYSTEM_PROMPT = `You are reading one section of a project specification on behalf of a specialty-trade SUBCONTRACTOR who is preparing a bid. Their trades are framing and drywall, plaster, EIFS, acoustical ceilings, and spray fireproofing. Report through the record_spec_costs tool.

Your job is narrow: find the things in this section that COST THIS SUBCONTRACTOR MONEY, and that an estimator pricing the work might not have allowed for. Not a summary of the section. Not everything it says.

Rules, in the order they matter.

1. NEVER INVENT A REQUIREMENT. Every finding must correspond to something this document actually states, and the quote field must contain the sentence you read it from, copied from the page. If you cannot quote it, do not report it. A person is about to check their bid against your list; a requirement that is not in the section sends them to add money for something nobody asked for.

2. REPORT WHAT COSTS MONEY, not what is merely specified. A section states dozens of requirements that any competent sub already prices by default. What belongs here is the requirement that is ABOVE the ordinary: Level 5 where Level 4 is normal, a rating that drives a different assembly, a mock-up somebody has to build, testing by a third party, a named product with no substitution permitted, attic stock, a deflection limit tighter than standard, an acoustic rating that adds insulation and sealant. If a competent estimator in these trades would have priced it without being told, leave it out.

3. NEVER SAY WHETHER THE BID ALREADY CARRIES IT. You have not seen the estimate, the takeoff, the catalogue or the bid. Whether this cost is already in somebody's number is their judgement and not yours, and a finding that reads as "you forgot this" when they did not is worse than no finding. Report what the section demands; say nothing about what they have priced.

4. whyItCosts is ONE LINE, factual, and checkable against the page. "Level 5 requires a skim coat over the entire surface, which is an extra pass that Level 4 does not include." Never "this may increase costs" and never "AI determined": a reason nobody can check is a reason nobody can overrule.

5. kind GROUPS the finding and never decides whether to report it. Use GENERAL whenever none of the others fits — it exists so this list can never refuse a real finding. FINISH_LEVEL for finish levels and skim coats. FIRE_RATING for rated assemblies, UL numbers, firestopping. ACOUSTIC for STC/NIC, acoustic insulation and sealant. MOCK_UP for sample panels and field mock-ups. TESTING for third-party inspection and field quality control. NAMED_PRODUCT for sole-sourced products and "no substitutions". ATTIC_STOCK for extra material left on site. PERFORMANCE for deflection criteria, height limits and load requirements. LIQUIDATED_DAMAGES for a stated per-day amount, or a per-day charge for missing a milestone. WORKING_HOURS for restricted hours, night or weekend work, noise windows, shift work, or occupied-building limits. WAGE_REQUIREMENT for prevailing or union wage scales, certified payroll, apprenticeship ratios, and local-hire requirements.

6. confidence is about THIS FINDING being real and correctly read. HIGH only when the document plainly states it and you have quoted it exactly. MEDIUM when you are reading it from context or the wording is ambiguous. LOW when the text is unclear, damaged, or you are unsure the requirement applies to this subcontractor's trades. BE HONEST AND PREFER LOW. Findings are shown lowest-confidence first, because the ones you are least sure of are the ones a person most needs to look at. A confident wrong finding is far worse than an honest uncertain one.

7. sourcePageLabel is where to look, as the document labels its pages — "Page 12", "09 21 16-4". Null if the document does not label them. On a thirty-page section this is what makes a quote checkable.

8. IF THIS IS NOT A SPECIFICATION SECTION — a drawing, an addendum, a quote, a submittal — return an EMPTY findings list and say so in readingReason. Do not try to find cost drivers in a document that has none. A document whose PURPOSE IS TO SOLICIT A BID — an invitation to bid, a bid form, instructions on how and when to submit — returns empty even when it mentions bonds, insurance or a completion date in passing: those terms belong to the contract documents it points AT, and reporting them from here reports the same requirement twice, from the weaker source. A Division 00 or Division 01 SECTION OF THE PROJECT MANUAL is a different document and does carry findings: see rule 9a.

9. IF IT IS A SPEC SECTION FOR WORK THAT IS NOT THESE TRADES — electrical, plumbing, roofing, earthwork — return an empty findings list and say which division it appears to be. Do not report another trade's requirements as this subcontractor's cost.

9a. DIVISION 00 AND DIVISION 01 ARE THE EXCEPTION TO RULE 9, AND YOU SHOULD READ THEM. They are not another trade's work — they are the contract conditions and general requirements that bind EVERY trade on the job, this subcontractor included. Three things there cost them money and are routinely missed because they are not in the drywall section: a LIQUIDATED DAMAGES clause with a per-day amount; WORKING HOUR restrictions — night work, weekend-only work, noise windows, an occupied building, shift work; and WAGE REQUIREMENTS — prevailing or union scales, certified payroll, apprenticeship ratios, local hire. Report these with the same quote-it-or-drop-it discipline as everything else.

10. An empty findings list is a real and useful answer. A section that demands nothing out of the ordinary is the common case, and saying so plainly is better than padding the list to look thorough.

11. A CONTRACT TERM COSTS MONEY DIFFERENTLY FROM A MATERIAL, AND whyItCosts MUST SAY WHICH. Liquidated damages at $2,500 a day is not $2,500 of cost — it is an exposure if the work runs late, and whether to carry anything for it is the estimator's judgement. Restricted hours and prevailing wages are different again: those change the RATE the work is done at, every hour of it. So state the mechanism and the number the document gives — "liquidated damages of $2,500 per calendar day past substantial completion" — and never a dollar amount you worked out yourself. You have not seen their schedule, their crew or their wage sheet. Rule 3 applies in full: do not say whether their bid already carries it.`;

/**
 * Read one spec section.
 *
 * `onUsage` is reported BEFORE the result is checked, through the shared helper
 * rather than a second copy of the rule: a call that produced nothing usable
 * still cost the money, and a bill that counts only successes understates.
 */
export async function extractSpecSection(params: {
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<SpecSectionExtraction> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const fileBlock: Anthropic.ContentBlockParam =
    params.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 } };

  const response = await client.messages.create({
    model: params.model ?? modelFor("SPEC_READ").model,
    max_tokens: 8192,
    system: SPEC_SYSTEM_PROMPT,
    tools: [SPEC_TOOL],
    tool_choice: { type: "tool", name: SPEC_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: `This is "${params.fileName}". Report what it demands that costs this subcontractor money.`,
          },
        ],
      },
    ],
  });

  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("the model returned no spec reading");
  }
  const raw = block.input as Partial<SpecSectionExtraction>;

  // NARROWED RATHER THAN CAST, and the kind is the one that matters: an
  // unrecognised kind becomes GENERAL rather than reaching Prisma as a value its
  // enum does not have, which would throw at write time and lose the whole
  // reading. `bid-recap.ts` paid for the casting version of this — a fifth enum
  // value arrived as `undefined` and `undefined + 2500` became a NaN bid total.
  const findings = Array.isArray(raw.findings) ? raw.findings : [];
  return {
    sectionNumber: typeof raw.sectionNumber === "string" ? raw.sectionNumber : null,
    title: typeof raw.title === "string" ? raw.title : null,
    readingReason: typeof raw.readingReason === "string" ? raw.readingReason : "",
    findings: findings.map((finding, index) => ({
      ordinal: typeof finding?.ordinal === "number" ? finding.ordinal : index + 1,
      kind: isSpecFindingKind(finding?.kind) ? finding.kind : "GENERAL",
      label: typeof finding?.label === "string" ? finding.label : "",
      requirement: typeof finding?.requirement === "string" ? finding.requirement : "",
      whyItCosts: typeof finding?.whyItCosts === "string" ? finding.whyItCosts : "",
      confidence: finding?.confidence === "HIGH" || finding?.confidence === "MEDIUM" ? finding.confidence : "LOW",
      quote: typeof finding?.quote === "string" ? finding.quote : "",
      sourcePageLabel: typeof finding?.sourcePageLabel === "string" ? finding.sourcePageLabel : null,
    })),
  };
}

export function isSpecFindingKind(value: unknown): value is SpecFindingKind {
  return typeof value === "string" && (SPEC_FINDING_KINDS as readonly string[]).includes(value);
}
