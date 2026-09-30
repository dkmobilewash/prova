import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * Reading a bid addendum — the letter a GC issues mid-bid — into a list of what
 * it changed.
 *
 * WHAT IT IS ALLOWED TO CONCLUDE, AND IT IS LESS THAN IT LOOKS. This returns
 * what the DOCUMENT SAYS it changed. It does not say whether any of it touches
 * work this contractor has priced, and it is not asked to: that judgement needs
 * the drawings and the estimate, neither of which is in the request.
 * `lib/ask/commands/estimating.ts` settled it when it refused `saveBidAddendum`
 * to the assistant — "an estimator's judgement about drawings the assistant has
 * not seen" — and reading the addendum does not change what the model has seen.
 *
 * So there is no `affectsPricedScope` field in the tool below, deliberately, and
 * a reader looking for one should find this paragraph instead. An earlier design
 * had one; it would have written a column that decides whether a crew may build
 * from a drawing.
 *
 * THE WHOLE FILE GOES TO THE MODEL, not extracted text, which is `quotes.ts`'s
 * shape and right here for a reason that is specific rather than inherited: GC
 * addenda are routinely scanned or faxed, and a scan has no text layer to
 * extract. `plan-ingest` reads text instead, but that is a COST rule about three
 * hundred pages per set, not a capability — at one document per click there is
 * nothing to save and a scan would simply fail.
 *
 * FORCED `tool_choice`, every field required-and-nullable, usage reported before
 * the result is checked. The house shape; `quotes.ts` documents each at length.
 */

const ADDENDUM_TOOL_NAME = "record_addendum";

/**
 * THE PROMPT'S VERSION, bumped whenever the text below changes in a way that
 * could change an output.
 *
 * `promptVersionCensus` fails the build if a usage row for this feature is
 * written without it, so rows from before and after a change are tellable apart
 * — which is the whole basis of ever saying a prompt change made anything
 * better.
 */
export const ADDENDUM_PROMPT_VERSION = "bid-addendum.1";

/** What kind of thing an item points at. Mirrors `BidAddendumReferenceKind`. */
export type AddendumReferenceKind =
  | "SPEC_SECTION"
  | "DRAWING"
  | "SCHEDULE"
  | "REQUIREMENT"
  | "BID_PROCESS"
  | "GENERAL";

export type AddendumItemExtraction = {
  ordinal: number;
  label: string | null;
  reference: string;
  referenceKind: AddendumReferenceKind;
  summary: string;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sourcePageLabel: string | null;
};

export type AddendumExtraction = {
  items: AddendumItemExtraction[];
  /** Why the reader read the document the way it did, checkable against it. */
  readingReason: string;
  /** The dates the document prints, as TEXT. The caller stores them as text and
   *  writes them into no date column — see `bid-addenda.prisma`. */
  issueDateText: string | null;
  bidDateText: string | null;
};

const ADDENDUM_SYSTEM_PROMPT = `You are reading an ADDENDUM that a general contractor has issued during a bid period, on behalf of a specialty-trade subcontractor (framing, drywall, plaster, EIFS, ceilings or fireproofing) who is preparing a bid. An addendum amends the bid documents: it revises spec sections, reissues drawings, answers bidders' questions, changes what the bid form demands, or moves the bid date. Extract what it changes into the record_addendum tool.

Rules, in order of importance:

1. NEVER INVENT AN ITEM. Every item you report must correspond to something the document actually states it is changing. Do not infer a consequence, do not add an item for something the addendum merely mentions, and do not split one change into several to look thorough. A person is about to decide what to re-check on a bid; an item that is not in the letter sends them looking for something that does not exist.

2. ONE ITEM PER CHANGE THE DOCUMENT MAKES, in the order the document makes them. Most addenda number their own items — "Item 4", "4.", "A.3". Put that in label exactly as printed, or null if the document does not number them. ordinal is your own 1-based ordering and must always be present.

3. reference is WHAT THE CHANGE POINTS AT, copied in the document's own words: a spec section ("09 21 16", "Section 09 22 16"), a drawing sheet ("Sheet A-201", "A-201"), a schedule ("Partition Type Schedule"), or a plain description when it points at nothing specific. Do not reformat it, do not expand it, and do not correct it. If one item changes several things, report the one it is principally about and mention the rest in summary.

4. referenceKind classifies that reference: SPEC_SECTION for a specification section, DRAWING for a sheet or detail, SCHEDULE for a schedule or table, REQUIREMENT for something the bid form or bid conditions now demand (a bond, a form, insurance, a subcontractor list), BID_PROCESS for the bid itself (the due date, a pre-bid meeting, a question deadline), GENERAL for anything else. Use GENERAL rather than forcing a poor fit.

5. summary is WHAT CHANGED, in one line, factual and in the document's own terms. "Section 09 21 16 2.3 replaced in full", "Ceiling grid revised at the north stair", "Bid date moved". Do not evaluate it, do not say whether it matters, and do not guess at its effect on anyone's price.

6. reason is why you say this item changes that reference, in words a person can check against the page with the document open. Quote or closely paraphrase the sentence you read it from. Never "the addendum says so" and never "AI determined": a reason nobody can check is a reason nobody can overrule.

7. confidence is about THIS ITEM being a real, correctly-read change: HIGH when the document plainly states it, MEDIUM when you are reading it from context or the wording is ambiguous, LOW when the text is unclear, damaged, or you are unsure you have the reference right. BE HONEST AND PREFER LOW. Items are shown lowest-confidence first, because the ones you are least sure of are the ones a person most needs to look at. A confident wrong item is far worse than an honest uncertain one.

8. sourcePageLabel is where to look, as the document labels it — "Page 3", "3 of 12", "Sheet 2". Null if the document does not label its pages. This is what makes reason checkable on a twelve-page letter.

9. issueDateText is the date the addendum itself was issued and bidDateText is the new bid due date IF this addendum moves it, both copied AS PRINTED, in the document's own format. Do not convert them, do not reformat them, and do not use today's date for either. Null when the document does not state one. These are shown to a person to type in; nothing reads them directly.

10. DO NOT JUDGE WHETHER ANY OF THIS AFFECTS WORK THAT HAS ALREADY BEEN PRICED. You have not seen this contractor's drawings, their takeoff or their estimate, and that judgement is the estimator's. Report what the document changes and stop there.

11. readingReason is one line about how you read the DOCUMENT AS A WHOLE, and it is a warning rather than a summary: say so if it is a scan you had trouble with, if items are numbered in a way you had to interpret, if attachments are referenced but not included, or if it does not appear to be an addendum at all. If the document is clean and plainly an addendum, say so briefly. Do not restate the items.

12. If the document is NOT an addendum — a spec section, a drawing, a quote, an invitation to bid — return an empty items list and say what it appears to be in readingReason. An empty list is a correct answer and is better than one invented item.`;

/**
 * Reads one addendum document and lists what it changes.
 *
 * THROWS only when the model returns nothing usable, which is a fault rather
 * than a failed read. The caller turns that into a sentence on a screen —
 * production redacts a thrown Server Action message to a digest, so nothing
 * about the document itself may travel this way.
 */
export async function extractAddendum(params: {
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  /** Metered against the addendum-page allowance — its own unit, because a
   *  bidding month is ~480 pages against a 300-page document allowance shared
   *  with Ask and compliance uploads. `ask-allowance.prisma` argues it. */
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<AddendumExtraction> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const fileBlock: Anthropic.ContentBlockParam =
    params.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 } };

  const response = await client.messages.create({
    model: params.model ?? modelFor("ADDENDUM_READ").model,
    // Larger than the 1,024 every other extractor here uses, and the reason is
    // structural rather than generous: those return ONE record, this returns a
    // LIST whose length the document decides. A twelve-item addendum with a
    // checkable reason per item does not fit in 1,024 tokens, and a truncated
    // tool call is a dropped item — which reads exactly like an addendum that
    // did not change that thing.
    max_tokens: 8192,
    system: ADDENDUM_SYSTEM_PROMPT,
    tools: [
      {
        name: ADDENDUM_TOOL_NAME,
        description:
          "Records what an addendum changes, item by item, for an estimator to check against the document before deciding what it means for their bid.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ordinal: { type: "number" },
                  label: { type: ["string", "null"] },
                  reference: { type: "string" },
                  referenceKind: {
                    type: "string",
                    enum: ["SPEC_SECTION", "DRAWING", "SCHEDULE", "REQUIREMENT", "BID_PROCESS", "GENERAL"],
                  },
                  summary: { type: "string" },
                  reason: { type: "string" },
                  confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                  sourcePageLabel: { type: ["string", "null"] },
                },
                required: [
                  "ordinal",
                  "label",
                  "reference",
                  "referenceKind",
                  "summary",
                  "reason",
                  "confidence",
                  "sourcePageLabel",
                ],
              },
            },
            readingReason: { type: "string" },
            issueDateText: { type: ["string", "null"] },
            bidDateText: { type: ["string", "null"] },
          },
          // EVERY FIELD REQUIRED, including the nullable ones — `quotes.ts` and
          // `anthropic.ts` both use this shape and give the reason: a model that
          // may omit a key returns `undefined`, and `undefined` and `null` then
          // mean two different things to the caller, "not read" against "not on
          // the document", a distinction nothing downstream wants to carry.
          required: ["items", "readingReason", "issueDateText", "bidDateText"],
        },
      },
    ],
    tool_choice: { type: "tool", name: ADDENDUM_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: `File name: ${params.fileName}` }],
      },
    ],
  });

  // Reported BEFORE the result check: a call that produced nothing usable still
  // cost the money, and a bill that counts only successes understates.
  await reportUsage(params.onUsage, response.usage);

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === ADDENDUM_TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return an addendum reading");
  }
  return toolUse.input as AddendumExtraction;
}
