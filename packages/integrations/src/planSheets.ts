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
/** Bumped to `.2` on 2026-10-05: `pageType` added as a required field and rule
 *  6a with it. Stored on every `PlanSheetProposal`, so a proposal from before
 *  today came from a reader that returned no page type at all — which is why a
 *  null there is not evidence the sheet is unclassifiable. */
export const PLAN_SHEET_PROMPT_VERSION = "plan-title-block.2";

export type SheetTitleBlock = {
  /** "A-101", "S2.1", "M-201". Null when the text does not carry one. */
  sheetNumber: string | null;
  /** "FIRST FLOOR PLAN". Null when absent. */
  title: string | null;
  /** "ARCHITECTURAL", "STRUCTURAL". Null when the sheet does not say. */
  discipline: string | null;
  /** What KIND of drawing this page is, as one of `SHEET_PAGE_TYPES`. Null when
   *  the text gives nothing to judge it from. Normalised, so a filter can act
   *  on it — unlike `title`, which is what the sheet printed. */
  pageType: SheetPageType | null;
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

6a. pageType is WHAT KIND OF DRAWING the page is, and it must be exactly one of: COVER, PLAN, ELEVATION, SECTION, DETAIL, SCHEDULE, OTHER. Judge it from the title and the sheet number, not from the discipline. PLAN for a floor, roof, reflected-ceiling or site plan. ELEVATION for exterior or interior elevations. SECTION for building or wall sections. DETAIL for a sheet of details at a larger scale. SCHEDULE for a sheet whose content is a TABLE — door, window, finish, partition-type or fixture schedules. COVER for a cover, title or drawing-index sheet. OTHER for anything else, including a legend, a general-notes sheet or a specification printed on a drawing. Null ONLY when the text gives you nothing to judge from, which is a different answer from OTHER: null means nobody can tell, OTHER means it is none of the six.
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
            // SPREAD, never a second list — the same reason `specs.ts` spreads
            // its finding kinds: a value the type admits and the schema does
            // not is one the model can never return, silently.
            pageType: { type: ["string", "null"], enum: [...SHEET_PAGE_TYPES, null] },
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
            "pageType",
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
    // Normalised here rather than at the call site, so every consumer — the stage,
    // the review screen, the eval — sees the one vocabulary and none of them has to
    // remember to. See `normaliseDiscipline` for what the eval found.
    discipline: normaliseDiscipline(text(input.discipline)),
    // Normalised here rather than trusted: the model is left the judgement
    // (which kind is this sheet?) and code takes the vocabulary, which is the
    // rule `normaliseDiscipline` was written for and ARCHITECTURE.md's own.
    pageType: normaliseSheetPageType(text(input.pageType)),
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

/**
 * The discipline prefixes a sheet number uses, and the word each one means.
 *
 * DETERMINISTIC ON PURPOSE, and the eval is why. The first run came back 9 of 9 on
 * sheet numbers with nothing over-claimed, and one field off: `S2.1` produced a
 * discipline of `"S"` where the sheet index wants `"STRUCTURAL"`. The prompt's own
 * rule is the cause — it lists the mapping as `(A architectural, S structural, …)`,
 * which reads as a legend, so returning the KEY is a fair reading of it.
 *
 * The fix is not a better sentence in the prompt. A sheet that spells "STRUCTURAL"
 * out would give the word while one identified only by its prefix would give the
 * letter, so the column would hold whichever the draughtsman happened to print —
 * and an index that shows "A" on one row and "ARCHITECTURAL" on the next is one
 * nobody can filter. This is a finite lookup, so it is a lookup: the model is left
 * the judgement (which discipline is this sheet?) and code takes the vocabulary.
 * ARCHITECTURE.md's rule, applied to a field rather than to a number.
 */
const DISCIPLINES: Record<string, string> = {
  A: "ARCHITECTURAL",
  S: "STRUCTURAL",
  M: "MECHANICAL",
  E: "ELECTRICAL",
  P: "PLUMBING",
  FP: "FIRE PROTECTION",
  FA: "FIRE ALARM",
  C: "CIVIL",
  L: "LANDSCAPE",
  ID: "INTERIOR DESIGN",
  Q: "EQUIPMENT",
  T: "TELECOMMUNICATIONS",
};

/**
 * One vocabulary for the discipline, whether the model gave a prefix or a word.
 *
 * AN UNRECOGNISED VALUE IS KEPT, NOT DISCARDED. A set can carry a discipline this
 * list has never heard of — "AV", "SECURITY", a consultant's own code — and dropping
 * it to null would lose what the sheet actually said in order to keep the column
 * tidy. Upper-cased so the index groups, and that is as far as it goes.
 */
export function normaliseDiscipline(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  return DISCIPLINES[trimmed] ?? trimmed;
}

/**
 * WHAT KIND OF DRAWING THIS PAGE IS — the one field the index could not filter on.
 *
 * `proposedTitle` already holds "EXTERIOR ELEVATIONS", and that is a label a person
 * reads, not something the app can act on: "FLOOR PLAN", "PLANS - LEVEL 2",
 * "ENLARGED PLAN" and "OVERALL FLOOR PLAN" are four strings and one kind. So this
 * is the kind, as a closed set.
 *
 * CLOSED, WHICH IS THE OPPOSITE OF `normaliseDiscipline` ABOVE, and the difference
 * is worth stating because the two sit three lines apart. Discipline KEEPS a value
 * this code has never heard of — a set can carry "AV" or a consultant's own code,
 * and dropping it would lose what the sheet said. Page type cannot afford that:
 * its whole purpose is to answer "which pages are the schedules?", and a filter
 * over an open vocabulary answers that wrongly the first time somebody's title
 * block says "SCHED." Nothing is lost by closing it, because the title is stored
 * verbatim one column away.
 */
export const SHEET_PAGE_TYPES = [
  "COVER",
  "PLAN",
  "ELEVATION",
  "SECTION",
  "DETAIL",
  "SCHEDULE",
  "OTHER",
] as const;

export type SheetPageType = (typeof SHEET_PAGE_TYPES)[number];

/**
 * The words a title block actually prints, mapped to the kind they mean.
 *
 * Longest-first matching, because "ENLARGED PLAN AND SECTION" contains both and
 * the first word of a title block is the one that names the sheet. A title
 * carrying two kinds is a real sheet and there is no right answer; this picks the
 * one printed first rather than pretending to a precision it has not got.
 */
const PAGE_TYPE_WORDS: readonly (readonly [string, SheetPageType])[] = [
  ["COVER SHEET", "COVER"],
  ["TITLE SHEET", "COVER"],
  ["COVER", "COVER"],
  ["INDEX", "COVER"],
  ["SCHEDULE", "SCHEDULE"],
  ["SCHED", "SCHEDULE"],
  ["ELEVATION", "ELEVATION"],
  ["ELEV", "ELEVATION"],
  ["SECTION", "SECTION"],
  ["SECT", "SECTION"],
  ["DETAIL", "DETAIL"],
  ["DTL", "DETAIL"],
  ["PLAN", "PLAN"],
];

/**
 * One vocabulary for the page type, whatever the model or the sheet called it.
 *
 * UNRECOGNISED BECOMES `OTHER` RATHER THAN BEING KEPT. That is the closed-set
 * decision above, and `OTHER` is a real answer: a legend, a general-notes page and
 * a door-hardware spec sheet are none of the six and a reader should see that
 * rather than a word the app invented for them.
 *
 * Null stays null. "Nobody has read this page yet" and "this page is none of the
 * six" are different facts, and collapsing them would make an unread page look
 * classified.
 */
export function normaliseSheetPageType(value: string | null): SheetPageType | null {
  if (value === null) return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  // An exact member wins outright, so a model answering in the vocabulary it was
  // given is never put through the word search.
  if ((SHEET_PAGE_TYPES as readonly string[]).includes(trimmed)) return trimmed as SheetPageType;
  let best: { at: number; type: SheetPageType } | null = null;
  for (const [word, type] of PAGE_TYPE_WORDS) {
    const at = trimmed.indexOf(word);
    if (at === -1) continue;
    // Earliest match wins; on a tie the longer word does, which is why
    // "COVER SHEET" precedes "COVER" in the list above.
    if (best === null || at < best.at) best = { at, type };
  }
  return best?.type ?? "OTHER";
}
