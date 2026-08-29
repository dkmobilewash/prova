import Anthropic from "@anthropic-ai/sdk";

// AI narrative layer over already-computed WIP figures — see lib/wip.ts in
// apps/web for the deterministic percentage-of-completion math. Claude never
// computes or restates a figure as a different value here; it only
// interprets numbers it's handed. Financial figures on a WIP schedule have
// to be exactly reproducible, which is why the math lives in plain
// TypeScript and this module's only job is explaining what the math means.
const SYSTEM_PROMPT = `You are a construction-industry financial analyst helping a general contractor read a job's WIP (work-in-progress) percentage-of-completion report.

You will be given ALREADY-COMPUTED figures for one job: contract value, percent complete, earned revenue, billed-to-date, and over/under-billing, plus a per-line-item breakdown. Every number you receive is exact and final — do not recompute, restate as a different value, or "correct" any figure. Your job is interpretation only: explain what the numbers mean and flag anything a project manager or the company's surety/lender would want to know.

Focus on:
- Whether the job is significantly overbilled (a liability — cash collected ahead of work performed) or underbilled (an asset, but a cash-flow risk if billing hasn't caught up)
- Any individual line item whose current cost forecast has moved meaningfully away from its original budget
- Anything that looks like it needs the PM's attention this week, not just a restatement of the dashboard numbers

Write 2-4 short sentences, plain prose, no markdown headers or bullet lists, no restating every number verbatim (the numbers are already shown on screen next to this text) — just the interpretation. If nothing stands out as a concern, say so plainly rather than manufacturing a false flag.`;

export interface WipNarrativeLineItemSummary {
  description: string;
  contractValue: number;
  percentComplete: number | null;
  budgetedCost: number | null;
  currentEstimatedCost: number | null;
  actualCostToDate: number;
}

export interface WipNarrativeJobSummary {
  jobName: string;
  jobStatus: string;
  contractValue: number;
  percentComplete: number | null;
  earnedRevenue: number;
  billedToDate: number;
  overUnderBilling: number;
  lineItems: WipNarrativeLineItemSummary[];
}

/**
 * Generates a short plain-language narrative over one job's WIP figures.
 * The figures themselves come from the caller (lib/wip.ts) — this function
 * never touches the database or does any arithmetic of its own.
 */
export async function generateWipNarrative(summary: WipNarrativeJobSummary): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(summary, null, 2),
      },
    ],
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude did not return a text response");
  }
  return textBlock.text;
}

const COMPLIANCE_DOCUMENT_TYPES = [
  "LIEN_WAIVER",
  "CERTIFICATE_OF_INSURANCE",
  "CERTIFIED_PAYROLL",
  "UNION_FRINGE_BENEFIT_FILING",
  "UNION_AGREEMENT",
] as const;

export type ComplianceDocumentTypeExtraction = (typeof COMPLIANCE_DOCUMENT_TYPES)[number];

export interface ComplianceDocumentExtraction {
  type: ComplianceDocumentTypeExtraction;
  /** The subcontractor, vendor, or union trust fund the document is about. */
  partyName: string;
  /** Lien waiver amount or fringe-benefit contribution. Null for a COI. */
  amount: number | null;
  /** ISO date (YYYY-MM-DD) strings — null when the document doesn't state one. */
  periodStart: string | null;
  periodEnd: string | null;
  effectiveDate: string | null;
  expiresAt: string | null;
  /** Anything Claude wants to flag for human review — illegible fields,
   * ambiguous dates, a guess it isn't fully confident in. Null if nothing
   * stands out. */
  notes: string | null;
}

const EXTRACTION_TOOL_NAME = "record_compliance_document";

const EXTRACTION_SYSTEM_PROMPT = `You are reading a scanned construction compliance document (a lien waiver, certificate of insurance, certified payroll report, union fringe/benefit filing, or union agreement/CBA) for a general contractor. Extract the fields into the record_compliance_document tool exactly as they appear on the document — do not infer or guess a value that isn't actually printed on the page. Use null for any field the document doesn't state. Dates must be ISO format (YYYY-MM-DD). If you're unsure about a field, still make your best extraction but say so in "notes".`;

/**
 * Reads an uploaded compliance document (PDF or image) and extracts
 * structured fields via a forced tool call — never free-text JSON, so
 * there's no parsing ambiguity about what Claude returned. The caller
 * (uploadComplianceDocument in apps/web/lib/actions.ts) persists these
 * fields as a normal, editable ComplianceDocument row; this function never
 * touches the database itself.
 */
export async function extractComplianceDocument(params: {
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
}): Promise<ComplianceDocumentExtraction> {
  const client = new Anthropic();

  const fileBlock: Anthropic.ContentBlockParam =
    params.mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 },
        };

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [
      {
        name: EXTRACTION_TOOL_NAME,
        description: "Records the fields extracted from the uploaded compliance document.",
        input_schema: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...COMPLIANCE_DOCUMENT_TYPES] },
            partyName: { type: "string" },
            amount: { type: ["number", "null"] },
            periodStart: { type: ["string", "null"] },
            periodEnd: { type: ["string", "null"] },
            effectiveDate: { type: ["string", "null"] },
            expiresAt: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
          },
          required: ["type", "partyName", "amount", "periodStart", "periodEnd", "effectiveDate", "expiresAt", "notes"],
        },
      },
    ],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: `File name: ${params.fileName}` }],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === EXTRACTION_TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return an extraction result");
  }
  return toolUse.input as ComplianceDocumentExtraction;
}

const TRADE_SCOPES = [
  "METAL_FRAMING_DRYWALL",
  "LATH_PLASTER",
  "EIFS",
  "ACOUSTICAL_CEILINGS",
  "FIREPROOFING",
] as const;

/** Where a drafted price came from — mirrors the PriceBasis enum in the
 * schema. Kept as a string union here so packages/integrations stays free of
 * a Prisma dependency. */
export type DraftPriceBasis = "COMPANY_CATALOG" | "HISTORICAL_BID" | "GENERAL_KNOWLEDGE";

export const DRAFT_PRICE_BASES: DraftPriceBasis[] = [
  "COMPANY_CATALOG",
  "HISTORICAL_BID",
  "GENERAL_KNOWLEDGE",
];

/** This company's own priced work, passed in so the draft reflects what it
 * actually charges rather than what the market roughly charges. */
export interface DraftReferenceData {
  catalogEntries: {
    id: string;
    description: string;
    unit: string | null;
    defaultUnitPrice: number | null;
    tradeScope: string | null;
  }[];
  /** Bids this company won, by trade — evidence of what its pricing has
   * actually cleared at, for scopes the catalog doesn't cover. */
  wonBids: { projectName: string; tradeScope: string | null; bidAmount: number }[];
}

export interface DraftLineItem {
  description: string;
  quantity: number;
  unit: string | null;
  /** A rough sale-price guess to give the PM a starting point — never a
   * quote, always subject to review (see aiDrafted on JobLineItem). Null
   * when nothing in the scope text gives even a rough basis to guess
   * from, rather than inventing a number. */
  unitPrice: number | null;
  tradeScope: (typeof TRADE_SCOPES)[number] | null;
  /** The catalog entry this line matched, when the scope clearly described
   * work this company already has a price for. Lets the caller create the
   * line through the same path "add from catalog" uses, so it carries a real
   * provenance link instead of a bare number. */
  catalogEntryId: string | null;
  /** How much to trust unitPrice. Null when no price was suggested — an
   * absent number needs no confidence label. */
  priceBasis: DraftPriceBasis | null;
}

/** Caps how much reference data goes into the prompt. A specialty sub's
 * catalog is small; this is a guard against a pathological one, not a
 * routine truncation. The caller logs nothing because nothing is silently
 * dropped in practice — but the cap is here rather than unbounded. */
const MAX_REFERENCE_CATALOG_ENTRIES = 200;
const MAX_REFERENCE_WON_BIDS = 40;

const DRAFT_TOOL_NAME = "record_draft_line_items";

const DRAFT_SYSTEM_PROMPT = `You are helping a specialty-trade construction SUBCONTRACTOR turn a plain-language scope of work into a first-draft list of estimate line items. This company self-performs a narrow family of trades (metal framing/drywall, lath & plaster, EIFS, acoustical ceilings, fireproofing) and bids to general contractors — it does not coordinate other subs. Draft only the work this company would perform itself.

Break the scope into distinct, billable line items the way an experienced estimator would structure a proposal — one line per distinct scope of work, not one giant catch-all line. For each line, give a reasonable quantity and unit (sq ft, lin ft, each, lump sum, etc.) based on what the text states or implies. Only set tradeScope when the line clearly matches one of the five given trade scopes — leave it null otherwise, don't force a fit.

PRICING. You may be given this company's own catalog of previously priced line items, and the amounts of bids it has won by trade. Use them — they are what this company actually charges, which is better evidence than general market rates:

1. If a line clearly matches a catalog entry (same work, same unit), reuse that entry's description wording and its default unit price. Set catalogEntryId to that entry's id and priceBasis to "COMPANY_CATALOG". Match on what the work IS, not on similar words — a catalog entry for 5/8" type X board is not a match for acoustic ceiling tile.
2. If no catalog entry matches but this company's won bids in the same trade give you a defensible basis, price from that and set priceBasis to "HISTORICAL_BID". Leave catalogEntryId null.
3. Otherwise estimate from general market knowledge and set priceBasis to "GENERAL_KNOWLEDGE". Leave catalogEntryId null. This is the weakest basis and it will be shown to the user as such, so do not reach for it when option 1 or 2 genuinely applies.
4. If you have no reasonable basis for a price at all, set unitPrice AND priceBasis to null. A missing price is fine; an invented one is not.

Never set catalogEntryId to an id that was not given to you, and never claim COMPANY_CATALOG for a price you did not take from a catalog entry. This is a draft for the estimator to review and correct, never a firm quote.`;

/**
 * Turns free-text scope of work into a draft list of JobLineItem rows —
 * the same shape every other line item uses, not a parallel "draft" table
 * (see ARCHITECTURE.md's rule: does it read/write JobLineItem, or does it
 * introduce a second shape to keep in sync by hand?). The caller
 * (draftLineItemsFromScope in apps/web/lib/actions.ts) persists these with
 * aiDrafted: true and never auto-approves them into a contract.
 */
export async function draftEstimateLineItems(
  scopeText: string,
  reference: DraftReferenceData = { catalogEntries: [], wonBids: [] },
): Promise<DraftLineItem[]> {
  const client = new Anthropic();

  const catalogEntries = reference.catalogEntries.slice(0, MAX_REFERENCE_CATALOG_ENTRIES);
  const wonBids = reference.wonBids.slice(0, MAX_REFERENCE_WON_BIDS);

  // Reference data goes in the user turn, not the system prompt: it changes
  // per company and per request, and putting it in the system prompt would
  // sit in front of every cacheable prefix.
  const referenceBlocks: string[] = [];
  if (catalogEntries.length > 0) {
    referenceBlocks.push(
      `This company's line item catalog (id | description | unit | default unit price | trade):\n` +
        catalogEntries
          .map(
            (entry) =>
              `${entry.id} | ${entry.description} | ${entry.unit ?? "-"} | ${
                entry.defaultUnitPrice ?? "-"
              } | ${entry.tradeScope ?? "-"}`,
          )
          .join("\n"),
    );
  }
  if (wonBids.length > 0) {
    referenceBlocks.push(
      `Bids this company has WON (project | trade | amount):\n` +
        wonBids
          .map((bid) => `${bid.projectName} | ${bid.tradeScope ?? "-"} | ${bid.bidAmount}`)
          .join("\n"),
    );
  }

  const userContent = [
    ...referenceBlocks,
    `Scope of work to draft line items from:\n${scopeText}`,
  ].join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    system: DRAFT_SYSTEM_PROMPT,
    tools: [
      {
        name: DRAFT_TOOL_NAME,
        description: "Records the draft line items broken out from the scope of work.",
        input_schema: {
          type: "object",
          properties: {
            lineItems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  quantity: { type: "number" },
                  unit: { type: ["string", "null"] },
                  unitPrice: { type: ["number", "null"] },
                  tradeScope: { type: ["string", "null"], enum: [...TRADE_SCOPES, null] },
                  catalogEntryId: {
                    type: ["string", "null"],
                    description:
                      "The id of the matched catalog entry, copied exactly from the catalog list provided. Null unless priceBasis is COMPANY_CATALOG.",
                  },
                  priceBasis: {
                    type: ["string", "null"],
                    enum: [...DRAFT_PRICE_BASES, null],
                    description:
                      "Where unitPrice came from. Null when unitPrice is null.",
                  },
                },
                required: [
                  "description",
                  "quantity",
                  "unit",
                  "unitPrice",
                  "tradeScope",
                  "catalogEntryId",
                  "priceBasis",
                ],
              },
            },
          },
          required: ["lineItems"],
        },
      },
    ],
    tool_choice: { type: "tool", name: DRAFT_TOOL_NAME },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === DRAFT_TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return a draft result");
  }
  const { lineItems } = toolUse.input as { lineItems: DraftLineItem[] };
  if (lineItems.length === 0) {
    throw new Error("Claude couldn't draft any line items from that scope text");
  }

  // Model output is not trusted with a foreign key or with its own
  // confidence label. A hallucinated catalogEntryId would become a real FK
  // and then feed a wrong actual cost back into that entry's default, and a
  // COMPANY_CATALOG badge on an invented number is precisely the false
  // confidence this basis field exists to prevent. Both are downgraded here
  // rather than rejected, so one bad row doesn't lose the whole draft.
  const knownCatalogIds = new Set(catalogEntries.map((entry) => entry.id));

  return lineItems.map((item) => {
    const catalogEntryId =
      item.catalogEntryId && knownCatalogIds.has(item.catalogEntryId) ? item.catalogEntryId : null;

    let priceBasis: DraftPriceBasis | null =
      item.priceBasis && DRAFT_PRICE_BASES.includes(item.priceBasis) ? item.priceBasis : null;

    // No price means no claim about where a price came from.
    if (item.unitPrice == null) priceBasis = null;
    // Claiming the catalog without a verified entry behind it is the one
    // combination that would overstate confidence, so it degrades to the
    // weakest basis rather than keeping the strongest.
    else if (priceBasis === "COMPANY_CATALOG" && !catalogEntryId) priceBasis = "GENERAL_KNOWLEDGE";
    // A price with no stated basis is a guess; label it as one.
    else if (priceBasis === null) priceBasis = "GENERAL_KNOWLEDGE";

    return { ...item, catalogEntryId, priceBasis };
  });
}
