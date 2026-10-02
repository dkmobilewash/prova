import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * COUNTING A SYMBOL ON A DRAWING — the instrument for an open question, and
 * NOT a shipped feature.
 *
 * `docs/ai/DECISIONS.md` has carried *"whether symbol-counting can reach a
 * precision an estimator would accept"* as an open question with zero code
 * behind it, and `FEATURE-AUDIT.md:469` carries plan/drawing takeoff via
 * computer vision as Missing and warns in capitals that it must not be flipped
 * by the plan-ingestion row above it — *that* feature reads a title block as
 * TEXT. Nothing in this app has ever measured geometry off a drawing.
 *
 * This file does not change that. **No action calls it, no route reaches it, it
 * is not in `AI_FEATURES`, and it is not metered** — it exists so an eval can
 * answer the question with a number instead of an argument, which is the same
 * sequence the Haiku title-block decision followed (9 of 9, 0 overclaimed, and
 * the eval decided it). Wiring it to a feature is a separate PR and needs the
 * answer first.
 *
 * ── WHY IT MEASURES FALSE CONFIDENCE AND NOT ACCURACY ──
 *
 * `DECISIONS.md`, in these words: *"the metric I care most about is false
 * confidence, not accuracy. A count that is 85% accurate and says so is useful;
 * a count that is 85% accurate and reads as certain is a wrong bid."*
 *
 * For a takeoff that is the whole question. An estimator who is told "42 doors,
 * and I am not confident" checks the sheet. One told "42 doors" prices 42 doors.
 * So the tool is shaped to make honest uncertainty EASY and cheap to express:
 * `countable` can be false, `count` can be null, `confidence` has a LOW rung the
 * prompt actively pushes toward, and `uncertainty` is required rather than
 * optional. A schema that only accepts a number is a schema that manufactures
 * one.
 *
 * ── THE RESOLUTION PROBLEM IS PHYSICS, AND IT IS ALREADY MEASURED ──
 *
 * `plan-ingest/planPdf.ts` established it: an ARCH D sheet is 36 INCHES wide, so
 * fitted to a vision tier's long edge it lands at ~44 DPI (1568px) or ~65 DPI
 * (2576px), which is why title blocks are read as vector text and never looked
 * at. A symbol has no text layer, so counting cannot borrow that trick.
 *
 * This function therefore takes the page as given and does NOT pretend to solve
 * that — it is the eval's job to run it on both a full sheet and a small one and
 * report which failed. If the model counts at 143 DPI and not at 44, the answer
 * to the open question is "yes, but it needs tiling", which is a different and
 * much more expensive project than "yes".
 */

export const SYMBOL_COUNT_PROMPT_VERSION = "symbol-count.1";

export type SymbolCount = {
  /** What was looked for, echoed back so a mismatch is visible. */
  symbol: string;
  /** False when the page cannot be counted reliably AT THIS RESOLUTION. The
   *  honest answer, and deliberately not a failure. */
  countable: boolean;
  /** Null whenever `countable` is false. Never a guess dressed as a number. */
  count: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** What would make this wrong, in words an estimator can check against the
   *  sheet. Required, because a count with no stated doubt is the failure mode
   *  this whole measurement is about. */
  uncertainty: string;
  /** Where on the sheet the symbols were found, so a person can look. */
  whereLooked: string;
};

const SYMBOL_TOOL: Anthropic.Tool = {
  name: "report_symbol_count",
  description: "Report how many of one symbol appear on this drawing sheet, and how sure you are.",
  input_schema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "The symbol you were asked to count, in your own words." },
      countable: {
        type: "boolean",
        description:
          "True only if you can see the symbols clearly enough to count them. False if the image is too coarse, " +
          "the symbols are too small, they overlap, or you are guessing.",
      },
      count: {
        type: ["integer", "null"],
        description: "How many you counted. MUST be null when countable is false.",
      },
      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
      uncertainty: {
        type: "string",
        description: "What could make this count wrong. Never empty, never 'none'.",
      },
      whereLooked: { type: "string", description: "Where on the sheet you looked." },
    },
    required: ["symbol", "countable", "count", "confidence", "uncertainty", "whereLooked"],
  },
};

const SYMBOL_SYSTEM_PROMPT = `You are looking at ONE sheet of construction drawings on behalf of a specialty-trade subcontractor (framing, drywall, plaster, EIFS, ceilings or fireproofing) who is preparing a bid. You will be asked to count how many of one particular symbol appear on the sheet. Report through the report_symbol_count tool.

Rules, in order of how much they matter.

1. AN HONEST "I CANNOT COUNT THIS" IS A CORRECT ANSWER AND IS WHAT YOU SHOULD GIVE WHENEVER IT IS TRUE. A large architectural sheet reduced to fit an image is very low resolution — a full-size sheet may arrive at roughly 44 pixels per inch, so a quarter-inch symbol is about eleven pixels across and a line weight is less than one. If you cannot clearly resolve the symbols, set countable to false and count to null. You will not be penalised for this. You WILL be judged harshly for a number you were not sure of.

2. NEVER REPORT A NUMBER YOU DID NOT COUNT. Do not estimate from density, do not infer from a grid pattern, do not assume a plan is regular, and do not round to something plausible. If you counted 23 say 23, not "about 25". If you counted part of the sheet and stopped, set countable to false and say so in uncertainty.

3. COUNT ONLY THE SYMBOL YOU WERE ASKED FOR. A drawing carries many marks that look similar at low resolution. If you cannot tell the requested symbol apart from another mark on the sheet, that is a reason for countable to be false, and name the confusion in uncertainty.

4. confidence is about THIS COUNT being right. HIGH only when the symbols are plainly resolved and you counted every one. MEDIUM when you are confident of the kind but may have missed one at an edge or in a dense area. LOW when you are reading faint or small marks. PREFER LOWER. An estimator shown a HIGH count prices it without checking; that is the failure this exists to avoid.

5. uncertainty must say what could make the count wrong, specifically and checkably — "two symbols overlap near the north wall and may be one", "the lower right quadrant is dense and I may have double-counted", "at this resolution a door swing and a radius dimension look alike". Never empty, never "none", never "I am confident". If you genuinely see no risk, say what you checked to rule one out.

6. whereLooked says which parts of the sheet you examined, so a person can go and look. Name regions as the sheet lets you — "throughout the floor plan", "the enlarged plan at the lower left", "the partition schedule". If you did not examine the whole sheet, say which part you did.

7. DO NOT describe the sheet, do not summarise the project, and do not offer a takeoff. One symbol, one count, your real confidence.`;

/**
 * Count one symbol on one sheet.
 *
 * `onUsage` is optional and the eval does NOT pass one, which is deliberate and
 * is the behaviour `docs/ai/DECISIONS.md` now records: an eval run bills the
 * account and writes no `AskUsage` row, so the cost panel reports the product's
 * spend rather than the account's. An eval metering itself against a company's
 * allowance would spend a customer's month on a measurement.
 */
export async function countSymbols(params: {
  fileBase64: string;
  symbol: string;
  /** What the symbol looks like, in the words a drawing would use. The eval
   *  supplies this; a shipped feature would too, from a symbol library. */
  looksLike: string;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<SymbolCount> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const response = await client.messages.create({
    model: params.model ?? modelFor("PLAN_INGESTION").model,
    max_tokens: 1_024,
    system: SYMBOL_SYSTEM_PROMPT,
    tools: [SYMBOL_TOOL],
    // FORCED, like every other extractor here: a tool call is the only shape
    // this can return, so prose is not an outcome to handle.
    tool_choice: { type: "tool", name: SYMBOL_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 },
          },
          {
            type: "text",
            text: `Count how many ${params.symbol} appear on this sheet. ${params.looksLike}`,
          },
        ],
      },
    ],
  });

  // Reported BEFORE the result is checked, through the shared helper rather
  // than a second copy of the rule: a call that produced nothing usable still
  // cost the money. `anthropic.ts`'s header argues why there is one of these.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("the model returned no symbol count");
  }
  const raw = block.input as Partial<SymbolCount>;

  // `countable: false` with a number is the one contradiction the schema cannot
  // express, and it is exactly the failure being measured — so it is normalised
  // HERE rather than left for the eval to interpret. A count that survives
  // alongside "I could not count this" would otherwise be graded as an answer.
  const countable = raw.countable === true;
  return {
    symbol: typeof raw.symbol === "string" ? raw.symbol : params.symbol,
    countable,
    count: countable && typeof raw.count === "number" ? raw.count : null,
    confidence: raw.confidence === "HIGH" || raw.confidence === "MEDIUM" ? raw.confidence : "LOW",
    uncertainty: typeof raw.uncertainty === "string" ? raw.uncertainty : "",
    whereLooked: typeof raw.whereLooked === "string" ? raw.whereLooked : "",
  };
}
