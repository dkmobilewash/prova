import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * ── READING A PARTITION LEGEND, WHICH IS NOT A TABLE ──
 *
 * `scheduleRows.ts` reads a schedule off a reconstructed grid, and that is the
 * right shape for a page that IS a grid. A partition legend usually is not:
 * across the five real sets measured on 2026-10-20 the only one is Camp Bow
 * Wow A130, drawn as five wall-section details side by side with their
 * callouts interleaved line by line, so the text of one type arrives split
 * across the text of the other four.
 *
 * Pulling one type's callouts out of that is the job this cannot be done in
 * code: the association is visual on the page and textual in the extract, and
 * the only thing that can read it is something that understands what the words
 * MEAN. So the model is given the whole page's lines and asked which codes
 * exist and what each is made of.
 *
 * ── TEXT ONLY. NO GEOMETRY, AND NO QUANTITIES. ──
 *
 * ARCHITECTURE.md's division, unchanged. This returns the architect's WORDS
 * for each type — "3 5/8\" MTL. STUD AT 16\" O.C." — and never a number the
 * estimate uses. `readPartitionAssembly` turns those words into components in
 * ordinary code, where the arithmetic is testable and a mutation run can prove
 * it, and a person accepts the result. No quantity a customer is billed from
 * passes through a model.
 *
 * That is also why the tool asks for the text VERBATIM rather than for a
 * parsed stud size: a model that returns 3.625 has made a measurement, and a
 * model that returns the phrase has read a drawing.
 */

export const WALL_LEGEND_PROMPT_VERSION = "wall-legend.1";

const TOOL_NAME = "record_wall_types";

export type WallTypeRead = {
  /** The code as printed — `A`, `B1`, `P-2`. Never normalised. */
  code: string;
  /** Every line describing this type, verbatim and in the order printed. */
  lines: string[];
  /** The type's own name where the legend gives one, else null. */
  name: string | null;
};

export type WallLegendRead = {
  types: WallTypeRead[];
  /** Which part of the page these came from, in words somebody can check. */
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You are reading a PARTITION LEGEND off a construction drawing, for a specialty-trade subcontractor (framing and drywall) preparing a bid. You are given every line of text on the sheet, in reading order, with cells on the same line separated by " | ".

The sheet defines the building's wall types. It may be a table, but it is more often a row of small wall-section DETAILS side by side — in which case the lines interleave, and one visual row of the page contains a cell from each detail. Your job is to put each type's own words back together.

Record what you find through the ${TOOL_NAME} tool.

1. A TYPE'S CODE IS WHAT THE DRAWING CALLS IT — a letter, a number, or both: "A", "B", "1", "A1", "P-2". Copy it exactly. It is usually drawn inside a small symbol beside or above the detail it labels. If you cannot tell what a detail's code is, leave it out entirely rather than inventing one; a wrong code attaches the wrong assembly to real walls.

2. LINES ARE VERBATIM. Copy the words as printed — "3 5/8\\" MTL. STUD AT 16\\" O.C.", "5/8\\" GYP. BD. EACH SIDE, PAINT". Do not tidy abbreviations, do not convert fractions, do not merge two lines into a sentence, and do NOT work out a stud size or a layer count. Code downstream does that from these words, and it is tested; your reading of a number is not.

3. ONE TYPE'S LINES ONLY. When the page interleaves several details, decide which detail each cell belongs to by its position on the line and by what the words describe, and give each type only its own. A line you cannot attribute goes to no type.

4. GENERAL NOTES ARE NOT A TYPE. A sheet carries notes that apply to all of them — "ALL LOAD BEARING STUDS TO BE 14 GAUGE", "SEAL ALL GAPS IN FIRE RATED WALLS". Do not attach these to any single type and do not invent a type for them.

5. IGNORE WHAT IS NOT A WALL TYPE. Title blocks, revision tables, drawing indexes, sheet numbers, copyright notices, and the detail callouts that reference other sheets.

6. CONFIDENCE is HIGH when each type's code and lines are unambiguous, MEDIUM when you had to judge which detail a line belonged to, LOW when the page may not be a partition legend at all. REASON says in one sentence where on the sheet you read these and what made it hard.

Finding NOTHING is a real answer: a sheet that turns out to be a UL firestop detail or a wall section describes somebody else's assemblies or no types at all, and an empty list with a reason is correct.`;

/** Reads one partition legend from the text of its page. */
export async function extractWallLegend(params: {
  /** Every line of the sheet's text, in reading order. */
  lines: readonly string[];
  pageNumber: number;
  sheetTitle?: string | null;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<WallLegendRead> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const body = params.lines.join("\n");
  const response = await client.messages.create({
    model: params.model ?? modelFor("SCHEDULE_READ").model,
    // A legend holds few types but many lines each, and the lines are copied
    // verbatim — so the output is roughly the size of the part of the page
    // that matters. Truncation here drops a type's last line, which reads as
    // an assembly with no insulation rather than as a failure.
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description:
          "Records the wall types a partition legend defines, for a person to check before anything is priced from them.",
        input_schema: {
          type: "object",
          properties: {
            types: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  name: { type: ["string", "null"] },
                  lines: { type: "array", items: { type: "string" } },
                },
                required: ["code", "lines"],
              },
            },
            reason: { type: "string" },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          },
          required: ["types", "reason", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          `Sheet ${params.pageNumber}` +
          (params.sheetTitle ? `, titled "${params.sheetTitle}"` : "") +
          `:\n\n${body}`,
      },
    ],
  });

  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((one) => one.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") {
    throw new Error("The model returned no legend reading.");
  }
  const raw = block.input as {
    types?: { code?: unknown; name?: unknown; lines?: unknown }[];
    reason?: unknown;
    confidence?: unknown;
  };
  const types: WallTypeRead[] = (Array.isArray(raw.types) ? raw.types : [])
    .map((one) => ({
      code: typeof one.code === "string" ? one.code.trim() : "",
      name: typeof one.name === "string" && one.name.trim() !== "" ? one.name.trim() : null,
      lines: Array.isArray(one.lines)
        ? one.lines.filter((l): l is string => typeof l === "string" && l.trim() !== "")
        : [],
    }))
    // A type with no code names nothing, and a type with no lines describes
    // nothing. Either way there is no assembly to propose.
    .filter((one) => one.code !== "" && one.lines.length > 0);

  return {
    types,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    confidence:
      raw.confidence === "HIGH" || raw.confidence === "MEDIUM" || raw.confidence === "LOW"
        ? raw.confidence
        : "LOW",
  };
}
