import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * READING A GC'S SUBCONTRACT, ONE CHUNK OF PAGES AT A TIME, FOR THE SUB.
 *
 * The spec, addendum and quote readers next door send the whole PDF and accept
 * the page label the model reports. This one is handed TEXT that code already
 * extracted, page by page, with a marker line before each page — for one
 * reason that decides everything else: every finding must carry a quote that is
 * then found VERBATIM in that same text, and the page is located by the caller
 * from where the quote actually sits. A whole-PDF call gives us neither the
 * text the model saw nor a page we did not have to take on trust.
 *
 * So the model's job here is interpretation only — what a clause MEANS for a
 * subcontractor, how hard it bites, what is commonly negotiated. It reports any
 * figure the clause states (LD per day, notice hours, a retainage percent) and
 * the caller keeps a figure only if its digits are inside the finding's own
 * quote. Nothing here computes a number, compares against the bid, or decides
 * what the sub has priced: that is deterministic code (ARCHITECTURE.md, "the
 * model only narrates").
 *
 * Narrowed rather than cast, exactly as `specs.ts`: an unknown category becomes
 * OTHER, an unknown severity LOW, a non-number figure null.
 */

/** Bump on any change to the prompt or the tool, so a review row records what
 *  produced it. `promptVersionCensus.test.ts` requires every reader to export one. */
export const SUBCONTRACT_REVIEW_PROMPT_VERSION = "subcontract-review.1";

export {
  SUBCONTRACT_FINDING_CATEGORIES,
  SUBCONTRACT_SEVERITIES,
  type SubcontractFindingCategory,
  type SubcontractSeverity,
} from "./subcontractCategories";
import {
  SUBCONTRACT_FINDING_CATEGORIES,
  SUBCONTRACT_SEVERITIES,
  type SubcontractFindingCategory,
  type SubcontractSeverity,
} from "./subcontractCategories";

/**
 * Narrower labels the version diff pairs CHANGED clauses on ("retainage went
 * from 5% to 10%" is one change, not a removal and an addition). A suggestion to
 * the model rather than a closed set: anything else is stored as given, and null
 * is always allowed.
 */
export const SUBCONTRACT_SUBTYPES = [
  "PAY_IF_PAID",
  "PAY_WHEN_PAID",
  "PAYMENT_TIMING",
  "RETAINAGE_RATE",
  "RETAINAGE_RELEASE",
  "BILLING_CUTOFF",
  "BILLING_FORMAT",
  "LD_RATE",
  "LD_PASS_THROUGH",
  "LD_CAP",
  "BROAD_FORM",
  "INTERMEDIATE_FORM",
  "LIMITED_FORM",
  "DUTY_TO_DEFEND",
  "NO_DAMAGES_FOR_DELAY",
  "ACCELERATION",
  "SCHEDULE_OBLIGATION",
  "DELAY_NOTICE",
  "CLAIM_NOTICE",
  "CHANGE_NOTICE",
  "TERMINATION_CONVENIENCE",
  "TERMINATION_DEFAULT",
  "BACKCHARGE_RIGHT",
  "WARRANTY_TERM",
  "CALLBACK",
  "INSURANCE_COVERAGE",
  "ADDITIONAL_INSURED",
  "PRIMARY_NONCONTRIBUTORY",
  "WAIVER_OF_SUBROGATION",
  "COMPLETED_OPS",
  "PERFORMANCE_BOND",
  "PAYMENT_BOND",
  "LIEN_WAIVER_FORM",
  "LIEN_WAIVER_TIMING",
  "PRIME_FLOW_DOWN",
  "DISPUTE_VENUE",
  "ARBITRATION",
  "SITE_SAFETY_PLAN",
  "BADGING",
  "BACKGROUND_CHECK",
  "DAILY_REPORTS",
  "CLEANUP",
  "CONTRACT_SUM",
  "SCOPE_ITEM",
  "ADDENDA_LIST",
] as const;

/**
 * Figures a clause STATES, every one nullable. The caller keeps a figure only
 * when its digits appear inside the finding's own quote, so a model that
 * computes or rounds has its number thrown away rather than shown.
 */
export type SubcontractTerms = {
  ldPerDay: number | null;
  ldCap: number | null;
  noticeHours: number | null;
  noticeDays: number | null;
  retainagePercent: number | null;
  paymentDays: number | null;
  /** A warranty period AS STATED — years and months are separate fields so
   *  "two (2) years" is warrantyYears 2, never a converted 24 months the quote
   *  does not contain. */
  warrantyYears: number | null;
  warrantyMonths: number | null;
  limitPerOccurrence: number | null;
  limitAggregate: number | null;
  completedOpsYears: number | null;
  contractSum: number | null;
  /** Free text the clause names — who a notice goes to, and in what form. */
  noticeRecipient: string | null;
  noticeForm: string | null;
};

export const SUBCONTRACT_TERM_NUMBER_KEYS = [
  "ldPerDay",
  "ldCap",
  "noticeHours",
  "noticeDays",
  "retainagePercent",
  "paymentDays",
  "warrantyYears",
  "warrantyMonths",
  "limitPerOccurrence",
  "limitAggregate",
  "completedOpsYears",
  "contractSum",
] as const satisfies readonly (keyof SubcontractTerms)[];

export type SubcontractFindingExtraction = {
  ordinal: number;
  category: SubcontractFindingCategory;
  subtype: string | null;
  severity: SubcontractSeverity;
  title: string;
  quote: string;
  /** The page the model believes it read this on. NOT STORED — the caller
   *  locates the quote itself. Kept only so an eval can report disagreement. */
  claimedPage: number | null;
  sectionRef: string | null;
  explanation: string;
  suggestedPosition: string;
  questionForGc: string | null;
  terms: SubcontractTerms;
};

export type SubcontractChunkExtraction = {
  findings: SubcontractFindingExtraction[];
  readingReason: string;
};

/** One page of text as the caller hands it over. */
export type SubcontractChunkPage = { page: number; lines: readonly string[] };

const TOOL_NAME = "record_subcontract_findings";

const nullableNumber = (description: string) => ({ type: ["number", "null"], description });
const nullableString = (description: string) => ({ type: ["string", "null"], description });

const TERM_PROPERTIES: Record<keyof SubcontractTerms, object> = {
  ldPerDay: nullableNumber("Liquidated damages per day, in dollars, exactly as stated."),
  ldCap: nullableNumber("A cap on liquidated damages, in dollars, if stated."),
  noticeHours: nullableNumber("A notice window stated in HOURS (48 for 'forty-eight (48) hours')."),
  noticeDays: nullableNumber("A notice window stated in DAYS."),
  retainagePercent: nullableNumber("A retainage percentage, as stated (10 for 10%)."),
  paymentDays: nullableNumber("Days to payment, as stated."),
  warrantyYears: nullableNumber("A warranty period stated in YEARS (2 for 'two (2) years')."),
  warrantyMonths: nullableNumber("A warranty period stated in MONTHS. Never convert years to months."),
  limitPerOccurrence: nullableNumber("An insurance limit per occurrence, in dollars."),
  limitAggregate: nullableNumber("An insurance aggregate limit, in dollars."),
  completedOpsYears: nullableNumber("Years completed-operations coverage must be kept."),
  contractSum: nullableNumber("The subcontract sum, in dollars, exactly as stated."),
  noticeRecipient: nullableString("Who a notice must go to, as the clause names them."),
  noticeForm: nullableString("The form a notice must take (written, certified mail, a named form)."),
};

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record the clauses in these subcontract pages that a subcontractor should understand before signing.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ordinal: { type: "integer", description: "Your own 1-based ordering." },
            category: { type: "string", enum: [...SUBCONTRACT_FINDING_CATEGORIES] },
            subtype: {
              type: ["string", "null"],
              description: `A narrower label: one of ${SUBCONTRACT_SUBTYPES.join(", ")}; or null.`,
            },
            severity: { type: "string", enum: [...SUBCONTRACT_SEVERITIES] },
            title: { type: "string", description: "Short and scannable — 'Pay-if-paid', '$1,500/day liquidated damages'." },
            quote: {
              type: "string",
              description:
                "The clause's own words, COPIED character for character from ONE page above (or across one page break). At least a full sentence. Never paraphrased, never stitched from two places.",
            },
            claimedPage: { type: ["integer", "null"], description: "The page number from the '=== page N ===' marker." },
            sectionRef: nullableString("The section number as PRINTED near the quote — '4.3', 'Article 9'. Null if none is printed."),
            explanation: { type: "string", description: "What this means for the subcontractor, in plain English, two sentences at most." },
            suggestedPosition: {
              type: "string",
              description: "What subcontractors commonly ask for instead, phrased as a negotiating position, one or two sentences.",
            },
            questionForGc: nullableString("One question to put to the GC about this clause, or null."),
            terms: {
              type: "object",
              properties: TERM_PROPERTIES,
              required: Object.keys(TERM_PROPERTIES),
            },
          },
          required: [
            "ordinal",
            "category",
            "subtype",
            "severity",
            "title",
            "quote",
            "claimedPage",
            "sectionRef",
            "explanation",
            "suggestedPosition",
            "questionForGc",
            "terms",
          ],
        },
      },
      readingReason: { type: "string", description: "What these pages are and how you read them, in one or two sentences." },
    },
    required: ["findings", "readingReason"],
  },
};

export const SUBCONTRACT_REVIEW_SYSTEM_PROMPT = `You are reading pages of a construction SUBCONTRACT — the agreement a general contractor (GC) has sent, or one of its exhibits — on behalf of the specialty-trade SUBCONTRACTOR who is being asked to sign it. Their trades are framing and drywall, plaster, EIFS, acoustical ceilings and spray fireproofing. Report through the record_subcontract_findings tool.

Your job: find the clauses that shift MONEY, RISK or a DEADLINE onto this subcontractor, so they can understand and negotiate them before signing. Not a summary of the contract.

Rules, in the order they matter.

1. QUOTE OR DROP. Every finding's quote must be copied CHARACTER FOR CHARACTER from the page text you were given — the same words, the same numbers, the same punctuation. Copy at least one full sentence of the clause. Never paraphrase, never correct a typo, never join words from two different places. Your quotes are checked by machine against the text; a quote that is not found word for word is thrown away and counted against you. If you cannot quote it, do not report it.

2. WHAT TO LOOK FOR, by category:
   PAYMENT — pay-if-paid (owner payment is a CONDITION of paying the sub) versus pay-when-paid (a timing rule), and how many days after the GC is paid.
   RETAINAGE — the percentage withheld and what releases it (substantial completion, final completion, owner release, project closeout).
   BILLING — the billing cutoff date, the required format (AIA G702/G703, a portal), supporting documents.
   LIQUIDATED_DAMAGES — a dollar amount per day, whether the owner's LDs pass through to the sub, any cap.
   INDEMNITY — broad form (sub indemnifies even for the GC's own sole negligence), intermediate (except the GC's sole negligence), limited (only to the extent of the sub's negligence); a duty to DEFEND.
   DELAY_AND_SCHEDULE — no damages for delay, acceleration at the sub's cost, schedule obligations.
   NOTICE — any window to give notice of a delay, claim or change (e.g. 48 hours, 7 days), who it goes to and in what form. These become hard deadlines; missing one usually waives the claim.
   TERMINATION — for convenience (and what is paid), for default (cure period).
   BACKCHARGE — the GC's right to charge the sub, with or without notice.
   WARRANTY — length, WHEN it starts (substantial completion of the sub's work versus the whole project), call-back obligations.
   INSURANCE — required coverages, limits, Additional Insured, Primary and Non-Contributory, Waiver of Subrogation, completed-operations duration.
   BONDING — performance and payment bonds, who pays.
   LIEN_WAIVER — the forms and when they are due.
   FLOW_DOWN — the prime contract's terms bound onto the sub, especially when the sub has not seen it.
   DISPUTE — venue, arbitration, whose law, fee shifting.
   SAFETY_SITE_ADMIN — site-specific safety plans, badging, background checks, daily reports, cleanup and its backcharge.
   SCOPE — the contract sum, the scope of work, an addenda or drawings list.
   OTHER — a clause that shifts money, risk or a deadline and fits none of the above. It exists so this list never refuses a real finding.

3. SEVERITY. HIGH: the clause can cost the subcontractor money or a claim they would otherwise have — pay-if-paid, broad-form indemnity, a duty to defend, no damages for delay, LDs passed through, a notice window shorter than 7 days, termination for convenience without overhead and profit. MEDIUM: a real but ordinary burden worth negotiating — retainage above 5%, a warranty starting at project completion, a completed-ops tail beyond 3 years. LOW: an administrative obligation worth knowing — badging, daily reports, a billing format. If you are unsure, choose the LOWER severity.

4. A FAIR CLAUSE IS NOT A FINDING. Pay-when-paid within a reasonable time, limited-form indemnity, 5% retainage released at substantial completion, mutual waiver of consequential damages — these protect the subcontractor or are ordinary. Report them only when the category is SCOPE (the contract sum and scope are always worth listing) or the clause states a deadline (a notice window is always worth listing, even a fair one, at LOW). Padding the list hides the clauses that matter.

5. FIGURES. When the clause states a number, put it in terms exactly as written: "one thousand five hundred dollars ($1,500.00) per calendar day" is ldPerDay 1500. Never compute, convert units yourself beyond the field's own definition, or round. A figure you did not read in this clause is null.

6. NEVER SAY WHAT THE BID CARRIES. You have not seen the subcontractor's bid, estimate or exclusions. Do not say they priced something or forgot it — the scope comparison is done separately, by people and by code.

7. explanation is PLAIN ENGLISH for a contractor, not a lawyer: what happens to them, in money or time, if this clause is enforced. suggestedPosition is what subcontractors COMMONLY negotiate, phrased as a position — "Ask for pay-when-paid with a 60-day outside date." Never "you must", never "this is illegal", never legal advice: a person will have an attorney review the high-risk terms.

8. sectionRef is the section number PRINTED near the clause, copied as printed. Null if none is printed — do not number sections yourself.

9. The pages are marked "=== <document> · page N ===". claimedPage is that N. A clause that runs across a page break may be quoted across it; quote only the text, never the marker line.

10. An empty findings list is a real answer — signature pages, a table of contents, a drawings index with nothing else. Say what the pages are in readingReason.`;

export async function reviewSubcontractChunk(params: {
  /** Shown to the model as the document name, e.g. "Subcontract Agreement v2". */
  documentLabel: string;
  /** What the person said this file is — "the agreement", "the insurance exhibit". */
  roleLabel: string;
  pages: readonly SubcontractChunkPage[];
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<SubcontractChunkExtraction> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const text = renderChunkText(params.documentLabel, params.pages);

  const response = await client.messages.create({
    model: params.model ?? modelFor("SUBCONTRACT_REVIEW").model,
    max_tokens: 8192,
    system: SUBCONTRACT_REVIEW_SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `These are pages from "${params.documentLabel}" (${params.roleLabel}). ` +
              `Record what in them a subcontractor should understand before signing.\n\n${text}`,
          },
        ],
      },
    ],
  });

  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("the model returned no subcontract reading");
  }
  return narrowSubcontractChunk(block.input);
}

/** The text exactly as the model sees it. Exported so the eval and the tests
 *  can assert a quote never includes the marker line. */
export function renderChunkText(documentLabel: string, pages: readonly SubcontractChunkPage[]): string {
  return pages.map((page) => `=== ${documentLabel} · page ${page.page} ===\n${page.lines.join("\n")}`).join("\n\n");
}

/** Narrow an untrusted tool input. Exported for the unit tests. */
export function narrowSubcontractChunk(input: unknown): SubcontractChunkExtraction {
  const raw = (input ?? {}) as { findings?: unknown; readingReason?: unknown };
  const findings = Array.isArray(raw.findings) ? raw.findings : [];
  return {
    readingReason: typeof raw.readingReason === "string" ? raw.readingReason : "",
    findings: findings.map((value, index) => {
      const finding = (value ?? {}) as Record<string, unknown>;
      return {
        ordinal: typeof finding.ordinal === "number" ? finding.ordinal : index + 1,
        category: isSubcontractFindingCategory(finding.category) ? finding.category : "OTHER",
        subtype: stringOrNull(finding.subtype),
        severity: finding.severity === "HIGH" || finding.severity === "MEDIUM" ? finding.severity : "LOW",
        title: typeof finding.title === "string" ? finding.title : "",
        quote: typeof finding.quote === "string" ? finding.quote : "",
        claimedPage: typeof finding.claimedPage === "number" ? finding.claimedPage : null,
        sectionRef: stringOrNull(finding.sectionRef),
        explanation: typeof finding.explanation === "string" ? finding.explanation : "",
        suggestedPosition: typeof finding.suggestedPosition === "string" ? finding.suggestedPosition : "",
        questionForGc: stringOrNull(finding.questionForGc),
        terms: narrowTerms(finding.terms),
      };
    }),
  };
}

function narrowTerms(value: unknown): SubcontractTerms {
  const raw = (value ?? {}) as Record<string, unknown>;
  const number = (key: string) => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    ldPerDay: number("ldPerDay"),
    ldCap: number("ldCap"),
    noticeHours: number("noticeHours"),
    noticeDays: number("noticeDays"),
    retainagePercent: number("retainagePercent"),
    paymentDays: number("paymentDays"),
    warrantyYears: number("warrantyYears"),
    warrantyMonths: number("warrantyMonths"),
    limitPerOccurrence: number("limitPerOccurrence"),
    limitAggregate: number("limitAggregate"),
    completedOpsYears: number("completedOpsYears"),
    contractSum: number("contractSum"),
    noticeRecipient: stringOrNull(raw.noticeRecipient),
    noticeForm: stringOrNull(raw.noticeForm),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function isSubcontractFindingCategory(value: unknown): value is SubcontractFindingCategory {
  return typeof value === "string" && (SUBCONTRACT_FINDING_CATEGORIES as readonly string[]).includes(value);
}
