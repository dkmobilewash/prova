import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * READING ONE SHEET'S TITLE BLOCK — from TEXT, never from the file or an image.
 *
 * WHY TEXT. A plan sheet is an ARCH D page, 36 inches wide. Sent as a document or
 * an image it is fitted to the model's long-edge limit — 2576px on the
 * high-resolution tier — which is 65 DPI, putting the 1/8" lettering a title block
 * uses at about eight pixels tall. The vector text is already in the PDF, so
 * rasterising the page throws away the only legible copy of the thing we came for,
 * and costs four to eight times as much per page for the privilege. The words come
 * out of the file with `pdfjs-dist` in Node and arrive here as a short string.
 *
 * SO THIS FUNCTION SEES NO GEOMETRY, and one consequence is worth stating: it
 * cannot tell a sheet number printed in the title block from one printed in a
 * revision stamp somewhere else on the page, because both arrive as lines of text.
 * That is what `proposedReason` is for — it has to say WHERE it read the number, in
 * words a reviewer can check against the same text.
 */

export const PLAN_SHEET_TOOL_NAME = "record_sheet";

/**
 * THE PROMPT'S VERSION, and this constant is the reason it exists.
 *
 * `AskUsage.promptVersion` has had no writer since it was added, and
 * `docs/ai/DECISIONS.md` argues that the guard for that must ship WITH the first
 * prompt file rather than after it — because a missing cap shouts and a missing
 * prompt version does not: "rows accumulate with `null`, nothing breaks, and the
 * first time somebody claims a prompt change made anything better, the rows cannot
 * be attributed to either version."
 *
 * This is that first prompt file. BUMP IT WHENEVER THE PROMPT BELOW CHANGES in a
 * way that could change an answer — a new rule, a reworded rule, a changed field
 * description. Not for a typo in a comment.
 */
export const PLAN_SHEET_PROMPT_VERSION = "plan-title-block.1";

export type SheetTitleBlock = {
  /** "A-101", "S2.1", "M-201". Null when the text does not carry one. */
  sheetNumber: string | null;
  /** "FIRST FLOOR PLAN". Null when absent. */
  title: string | null;
  /** "ARCHITECTURAL", "STRUCTURAL". Null when the sheet does not say. */
  discipline: string | null;
  /** The scale as PRINTED — `1/4" = 1'-0"`, "NTS". Never converted. */
  scale: string | null;
  /** The revision as printed on this sheet — "REV 2", "ASI-12". */
  revision: string | null;
  /** The issue date as PRINTED, as characters. Never parsed into a date here. */
  issueDate: string | null;
  /** Where each value was read, in words somebody can check. */
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You are reading the title block of one sheet from a construction drawing set, for a specialty-trade subcontractor (framing, drywall, plaster, EIFS, ceilings or fireproofing) who needs to find the sheets that affect their scope. You are given the TEXT lifted off the sheet, in reading order. Record it into the ${PLAN_SHEET_TOOL_NAME} tool.

Rules, in order of importance:

1. NEVER INVENT A SHEET NUMBER. Report a sheet number only if one is printed in the text. If the text does not carry one, set sheetNumber to null and say so in reason. A wrong sheet number is worse than none: it labels somebody's measured quantities with another floor's name, and they will not notice until the quantities are in a bid.
2. REPORT WHAT IS PRINTED, NOT WHAT IT MEANS. scale is the characters on the sheet — \`1/4" = 1'-0"\`, "NTS", "AS NOTED" — never converted to a ratio. issueDate is the date as printed — "03/04/26", "MARCH 4 2026" — never reformatted and never today's date. revision is the label the architect used — "REV 2", "ASI-12", "BULLETIN 5", "DELTA 3".
3. reason IS A SENTENCE SOMEBODY CAN CHECK against the text you were given, naming where each value came from — "Sheet number and title on the last two lines; discipline from the A- prefix". Never "AI determined" or "extracted from the title block": a reason nobody can check is a reason nobody can overrule. Keep it to one or two short sentences, and do not restate every value you already recorded.
4. confidence is about THIS READING, not about your general ability. HIGH only when the sheet number and title are unambiguous. MEDIUM when you had to choose between candidates. LOW when the text is fragmentary, when the sheet number might be a drawing reference rather than this sheet's own, or when you are reporting a number you are not sure belongs to this sheet. An honest LOW is the correct answer and costs nothing; a HIGH that is wrong is a sheet index somebody trusts.
5. A sheet number is this sheet's OWN identifier, usually the largest or last text in a title block. Drawing text often REFERENCES other sheets — "SEE A-501", "DETAIL 3/A-301", "SIM TO S-102". Those are references, not this sheet's number. If every candidate looks like a reference, report null and say so.
6. discipline is the drawing discipline the sheet belongs to, from the text or from the sheet number's prefix (A architectural, S structural, M mechanical, E electrical, P plumbing, FP or FA fire protection, C civil, L landscape, ID interior design, Q equipment). Null if neither says.
7. If the text is clearly not a title block at all — a specification page, a legend, a schedule with no sheet identity — set every field except reason and confidence to null, say what it appears to be in reason, and use LOW.`;

/**
 * Reads one sheet's title block from its text.
 *
 * THROWS only when the model returns nothing usable, which is a genuine fault
 * rather than a failed read. The caller converts that into a sentence, because a
 * stage's failure text is rendered on screen and production redacts a thrown
 * message to a digest.
 */
export async function extractSheetTitleBlock(params: {
  /** The title block's words, in reading order. */
  titleBlockText: string;
  /** 1-based, so the model can say when a number disagrees with the position. */
  pageNumber: number;
  /** Whether the text came from the whole page rather than the title-block region,
   *  which is a reason to be less sure and the model is told so. */
  wholePageFallback?: boolean;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<SheetTitleBlock> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const preamble = params.wholePageFallback
    ? `This is the text of the WHOLE SHEET, because no title block could be located in the usual corner. Expect drawing text mixed in with the title block's own, and be correspondingly less sure.`
    : `This is the text of the sheet's title-block area.`;

  const response = await client.messages.create({
    model: params.model ?? modelFor("PLAN_INGESTION").model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: PLAN_SHEET_TOOL_NAME,
        description: "Records what one sheet's title block says, for a person to check before accepting it.",
        input_schema: {
          type: "object",
          properties: {
            sheetNumber: { type: ["string", "null"] },
            title: { type: ["string", "null"] },
            discipline: { type: ["string", "null"] },
            scale: { type: ["string", "null"] },
            revision: { type: ["string", "null"] },
            issueDate: { type: ["string", "null"] },
            reason: { type: "string" },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          },
          // EVERY FIELD REQUIRED, including the nullable ones — the shape
          // `quotes.ts` and `anthropic.ts` both use. A model that may omit a key
          // returns `undefined` for it, and `undefined` and `null` then mean two
          // different things to the caller ("not read" against "not on the sheet")
          // that nothing downstream wants to carry. Required-and-nullable collapses
          // them to one.
          required: [
            "sheetNumber",
            "title",
            "discipline",
            "scale",
            "revision",
            "issueDate",
            "reason",
            "confidence",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: PLAN_SHEET_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${preamble}\nSheet position in the set: page ${params.pageNumber}.` },
          { type: "text", text: params.titleBlockText },
        ],
      },
    ],
  });

  // REPORTED BEFORE THE RESULT IS CHECKED, because a call that produced nothing
  // usable still cost the money. `reportUsage` is imported rather than copied for
  // the same reason: two copies of this rule is how one of them stops being true.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find(
    (part): part is Anthropic.ToolUseBlock => part.type === "tool_use" && part.name === PLAN_SHEET_TOOL_NAME,
  );
  if (!block) throw new Error("the model returned no sheet reading");

  const input = block.input as Partial<SheetTitleBlock>;
  const confidence =
    input.confidence === "HIGH" || input.confidence === "MEDIUM" || input.confidence === "LOW"
      ? input.confidence
      : // An unrecognised value is treated as the LEAST confident rather than
        // trusted into an enum — the posture `readBidQuoteDocument` takes with a
        // date it cannot parse. Over-claiming confidence is the expensive mistake
        // here, so the fallback goes the safe way.
        "LOW";

  return {
    sheetNumber: text(input.sheetNumber),
    title: text(input.title),
    discipline: text(input.discipline),
    scale: text(input.scale),
    revision: text(input.revision),
    issueDate: text(input.issueDate),
    reason: text(input.reason) ?? "The reading gave no reason, so treat it as unchecked.",
    confidence,
  };
}

/** A trimmed string, or null — so "" and "   " cannot reach a column that means
 *  "the sheet did not say" by being null. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
