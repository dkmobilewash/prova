import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * Reading a quote a sub or supplier sent, into the fields a `BidQuote` holds.
 *
 * WHAT THIS IS NOT, AND IT IS WORTH LEADING WITH: a new quote schema. The
 * step-1 plan specified `QuoteDocument`/`QuoteLine` models for this feature, and
 * that was wrong — `BidQuote` in `bid-levelling.prisma` already IS the
 * normalised inbound quote, and `BidLevelling.tsx` already compares them within
 * a package, already excludes unanswered requests so a null cannot sort to the
 * front as the cheapest, and already diffs exclusions to say whether two prices
 * are comparable at all. Building a second model beside it would have been the
 * one thing the brief opens by forbidding.
 *
 * So this file does the only part that was missing: turning a PDF into the
 * values a person then corrects.
 *
 * NOTHING HERE WRITES ANYTHING. It returns a proposal. The estimator reads it in
 * the form they already use and presses save, and `saveBidQuote` — unchanged —
 * is what creates the row. That is the brief's "the AI suggests, the estimator
 * reviews, the existing data model stays the source of truth", and the reason it
 * needs no provenance table: the proposal lives in a form until a human submits
 * it, so there is never an un-reviewed value in the database to account for.
 *
 * FORCED `tool_choice`, NOT NATIVE CITATIONS. Every extractor in this codebase
 * is forced-tool, and for this one the choice is also constrained: the API
 * rejects `citations` alongside `output_config.format` with a 400, so a
 * structured extraction and native citations cannot both be had. Structure wins
 * here — the caller needs an amount it can parse, not a passage it can quote.
 *
 * MONEY IS RETURNED AS A NUMBER OR NULL, NEVER GUESSED. The one thing this must
 * not do is invent a total. A quote whose price is a range, or conditional, or
 * spread over alternates with no single figure, returns `amount: null` and says
 * why in `readingNotes` — and a null amount is a state the levelling module
 * already understands, because it is the same state an unanswered request is in.
 * Making one up would put a number an estimator is about to bid against on a
 * screen with nothing marking it as invented.
 */

/** What reading one quote document proposes. Every field is a SUGGESTION. */
export interface BidQuoteExtraction {
  /** Who quoted, as printed on the document — a company name, not a person's.
   *  Empty string when the document names nobody, which is a real case with a
   *  scanned fax and is better than inventing a vendor. */
  vendorName: string;
  /** What is being bought out, in the sub's own words — "Metal stud framing",
   *  "Hang and finish". Null when the document does not say, because
   *  `packageLabel` groups the comparison and a wrong guess splits a group. */
  packageLabel: string | null;
  /**
   * The quoted total, or NULL when there is not exactly one.
   *
   * Null is the honest answer more often than it looks: a quote with a base
   * price plus separately priced alternates has no single total until somebody
   * decides which alternates are in, and that decision is the estimator's.
   */
  amount: number | null;
  /** The date the quote was given, ISO `YYYY-MM-DD`, or null. NOT today's date
   *  — this app's rule is that dates which matter are entered, not stamped, and
   *  a quote logged on Friday for a Tuesday price is a Tuesday price. */
  quotedOn: string | null;
  /** What the quote explicitly excludes, one per line, in the sub's words.
   *  THE FIELD THAT DECIDES WHETHER THE CHEAPEST NUMBER IS THE BEST NUMBER —
   *  `BidQuote.exclusions` exists for exactly that, and a comparison that
   *  cannot read it buys a hole in the scope. */
  exclusions: string | null;
  /** Anything the reader should know before trusting the above: a price that
   *  was a range, an illegible figure, two totals on one page, a document that
   *  is not a quote at all. Null when nothing stands out. */
  readingNotes: string | null;
}

const QUOTE_TOOL_NAME = "record_quote";

const QUOTE_SYSTEM_PROMPT = `You are reading a price quote that a subcontractor or material supplier has sent to a specialty-trade contractor (framing, drywall, plaster, EIFS, ceilings or fireproofing). Extract it into the record_quote tool.

Rules, in order of importance:

1. NEVER INVENT A NUMBER. Only report an amount that is printed on the document as the price for the work. If there is no single total — a range, a price per unit with no quantity, a base plus separately priced alternates, an illegible figure — set amount to null and explain in readingNotes. A wrong total is far worse than no total, because the person is about to compare it against another sub's price.
2. Amount is the quoted price for the work, as a plain number without currency symbols or thousands separators. If the document shows a subtotal, tax and a total, report the TOTAL. If tax is listed separately and no total is given, report the subtotal and say so in readingNotes.
3. exclusions is what the quote says it does NOT include, one per line, in the sub's own words. Look for headings like "Exclusions", "Not included", "Clarifications", "Qualifications". Do not paraphrase and do not add exclusions you merely infer from the scope.
4. quotedOn is the date printed on the quote, as YYYY-MM-DD. If only a month and year appear, or no date at all, use null. Never use today's date.
5. vendorName is the quoting company's name as printed. Not a salesperson's name. Empty string if the document names nobody.
6. packageLabel is a short description of the scope being priced, in the words the document uses. Null if it does not say.
7. If the document is not a price quote at all — an invoice, a spec section, a submittal — set amount to null and say what it appears to be in readingNotes.
8. readingNotes IS A WARNING, NOT A SUMMARY, AND IT MUST BE null ON A CLEAN READ. The person is looking at every field you filled in, with the document open beside it. Write a note ONLY when something would change what they do next: there is no single total and why, a figure you are unsure you read correctly, two totals on one page, a date you could not establish, or a document that is not a quote. Do NOT restate the amount, the vendor, the project, the address or the scope. Do NOT list the fields the document does not have. Do NOT describe watermarks, stamps or markings unless they bear on whether the price is real. A quote with one printed total and its exclusions listed needs no note at all, and must get none: the note appears on screen as "Check these before you save", so a note on every quote is a note nobody reads, which costs you the one that mattered.`;

/**
 * Reads one quote document and proposes its fields.
 *
 * THROWS only when the model returns nothing usable, which is a genuine fault
 * rather than a failed read. The caller converts that into a sentence; nothing
 * about a quote it could not read should reach a person as a digest.
 */
export async function extractBidQuote(params: {
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  /** Metered like every other model call. A quote PDF is the same cost shape as
   *  a compliance document — a whole file base64'd into one request — and it
   *  spends the SAME page allowance, because a second ledger for a second kind
   *  of document is how a bill stops adding up. */
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<BidQuoteExtraction> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const fileBlock: Anthropic.ContentBlockParam =
    params.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 } };

  const response = await client.messages.create({
    model: params.model ?? modelFor("QUOTE_EXTRACT").model,
    max_tokens: 1024,
    system: QUOTE_SYSTEM_PROMPT,
    tools: [
      {
        name: QUOTE_TOOL_NAME,
        description: "Records the fields read off the quote document, for a person to check before saving.",
        input_schema: {
          type: "object",
          properties: {
            vendorName: { type: "string" },
            packageLabel: { type: ["string", "null"] },
            amount: { type: ["number", "null"] },
            quotedOn: { type: ["string", "null"] },
            exclusions: { type: ["string", "null"] },
            readingNotes: { type: ["string", "null"] },
          },
          // EVERY FIELD REQUIRED, including the nullable ones, which is the same
          // shape the compliance extractor uses. A model that may omit a key
          // returns `undefined` for it, and `undefined` and `null` then mean
          // two different things to the caller — "not read" against "not
          // present on the document" — a distinction nothing downstream wants
          // to carry. Required-and-nullable collapses it to one.
          required: ["vendorName", "packageLabel", "amount", "quotedOn", "exclusions", "readingNotes"],
        },
      },
    ],
    tool_choice: { type: "tool", name: QUOTE_TOOL_NAME },
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
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === QUOTE_TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return a quote extraction");
  }
  return toolUse.input as BidQuoteExtraction;
}
