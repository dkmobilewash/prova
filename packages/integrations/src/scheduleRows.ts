import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * READING A DOOR, WINDOW OR FINISH SCHEDULE off the grid that
 * `lib/plan-ingest/scheduleTable.ts` reconstructed.
 *
 * THE SPLIT IS THE POINT. Code recovered the table from text coordinates — which
 * strings share a baseline, where one cell ends and the next begins — because
 * that is arithmetic and ARCHITECTURE.md says arithmetic stays deterministic.
 * This asks the only question code cannot: which column is the MARK, which is the
 * size, which rows are headers and which are real. A draughtsman can title a
 * column "MK", "NO.", "DOOR #" or nothing at all, and no lookup survives that.
 *
 * WHY IT MATTERS MORE THAN THE OTHER READERS. A spec finding is advice an
 * estimator weighs. A schedule row becomes a COUNT — fifty doors, each with a
 * type and a size — and a count becomes a quantity in a bid. So the rules below
 * are stricter than the spec reader's in one specific way: a row this reader is
 * unsure of is DROPPED rather than reported with low confidence, because a
 * fifty-first door nobody ordered is worse than fifty with a gap somebody fills
 * by hand.
 */

export const SCHEDULE_ROWS_PROMPT_VERSION = "schedule-rows.1";
const SCHEDULE_TOOL_NAME = "record_schedule_rows";

/** What a schedule is OF. Closed, because each kind feeds different work. */
export const SCHEDULE_KINDS = ["DOOR", "WINDOW", "FINISH", "PARTITION", "FIXTURE", "OTHER"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export type ScheduleRowRead = {
  /** The mark exactly as printed — "101", "A1", "W-3". Never normalised: a mark
   *  is an identity on somebody else's drawing and we do not get to tidy it. */
  mark: string;
  /** What the row is, in the schedule's own words — "HOLLOW METAL", "WOOD". */
  description: string | null;
  /** The size as PRINTED, uninterpreted — `3'-0" x 7'-0"`. Never parsed into
   *  numbers here: `lib/feet-inches.ts` is the app's one reader for that, and a
   *  second parser in a model's output is a second authority. */
  size: string | null;
  /** How many, when the schedule states a count for the row. Null is the common
   *  case: one row is usually one item and the count comes from counting rows. */
  quantity: number | null;
  /** Anything the row carries that the fields above do not — a fire rating, a
   *  hardware set, a remark. The schedule's words, not a summary. */
  notes: string | null;
};

export type ScheduleRowsRead = {
  kind: ScheduleKind;
  /** The schedule's own title, as printed. */
  title: string | null;
  rows: ScheduleRowRead[];
  /** Which columns were read as what, in words somebody can check against the
   *  grid they were given. The reason a proposal can be overruled. */
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You are reading one SCHEDULE off a construction drawing, for a specialty-trade subcontractor (framing and drywall, plaster, EIFS, acoustical ceilings, spray fireproofing) who is preparing a bid. You are given the sheet's text already reconstructed into a grid: one row per line, cells separated by " | ". Record the schedule through the ${SCHEDULE_TOOL_NAME} tool.

The grid was built from text positions by code, so the ROWS and CELLS are reliable. What they MEAN is your job.

Rules, in the order they matter.

1. NEVER INVENT A ROW, AND DROP A ROW YOU ARE UNSURE OF. Every row you report must correspond to a line of the grid you were given. This is stricter than it sounds and it is deliberate: these rows become a COUNT, and a count becomes a quantity in a bid. A schedule of fifty doors read as fifty-one is a door somebody orders and nobody needs. If a line might be a continuation, a sub-heading, a total or a note, LEAVE IT OUT and say so in reason. Fifty rows with a gap a person fills is better than fifty-one with a stranger in it.

2. MARK IS THE IDENTITY AND IT IS COPIED EXACTLY. Whatever the column is headed — MARK, MK, NO., DOOR #, TYPE, or nothing — the value that identifies the row is the mark, and you reproduce it character for character. Do not pad "1" to "101", do not strip a leading zero, do not expand "A1" to "A-1". It is an identity on somebody else's drawing.

3. HEADER ROWS ARE NOT ROWS. The first line is usually the column headings, and a long schedule repeats them where it breaks across the sheet. Use them to decide which column is which; never report one as a row.

4. SIZE IS COPIED, NEVER CONVERTED. Report \`3'-0" x 7'-0"\` as it appears. Do not turn it into inches, decimal feet, or a width and a height. Something downstream reads feet and inches and it is not you.

5. quantity IS ONLY FOR A COUNT THE SCHEDULE STATES. Most schedules are one row per item and carry no quantity column; null is the right answer and the common one. Never put 1 in it to be helpful — a null means "count the rows" and a 1 means "the schedule said one", and a bid built on the difference is wrong in a way nobody can see.

6. kind IS WHAT THE SCHEDULE IS OF: DOOR, WINDOW, FINISH, PARTITION, FIXTURE, or OTHER. Judge it from the title and the columns. OTHER is a real answer — an equipment schedule or a louvre schedule is none of the five, and forcing it into one would put a louvre in the door count.

7. reason NAMES WHICH COLUMN YOU READ AS WHAT, checkable against the grid: "Column 1 is the mark (headed MK), column 3 the size, column 4 a fire rating read into notes. Line 7 looked like a repeated header and was dropped." Never "extracted the schedule" — a reason nobody can check is a reason nobody can overrule.

8. confidence IS ABOUT THE WHOLE READING. HIGH when the columns are plainly headed and every row is unambiguous. MEDIUM when you inferred a column from its values. LOW when the grid is broken, the columns are unclear, or you dropped several lines you could not place. Prefer LOW and say why: the rows are shown to a person to accept, and an honest LOW gets read where a confident wrong reading gets accepted.

9. IF THIS IS NOT A SCHEDULE — a plan, a details sheet, a legend, a page of notes that happens to be in columns — return an EMPTY rows list, say what it appears to be in reason, and use LOW. A reader asked to find things will find things, and a legend read as a finish schedule is pure invention.`;

/** Reads one schedule off a reconstructed grid.
 *
 *  THROWS only when the model returns nothing usable, which is a fault rather
 *  than a failed read — the caller turns that into a sentence, because a stage's
 *  failure text is rendered on screen and production redacts a thrown message. */
export async function extractScheduleRows(params: {
  /** The grid from `gridText` — one row per line, cells separated by " | ". */
  grid: string;
  /** 1-based, so the reason can refer to the sheet a person is looking at. */
  pageNumber: number;
  /** The sheet's own title, when the title block gave one. Helps rule 6. */
  sheetTitle?: string | null;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<ScheduleRowsRead> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const response = await client.messages.create({
    model: params.model ?? modelFor("SCHEDULE_READ").model,
    // LARGER THAN THE TITLE BLOCK'S 1,024 and for the reason `specs.ts` gives:
    // this returns a LIST whose length the document decides. A sixty-door
    // schedule with five fields a row does not fit in 1,024, and a truncated
    // tool call is a DROPPED ROW — which reads exactly like a schedule that was
    // shorter than it is. That is the failure this feature exists to prevent,
    // arriving through the plumbing.
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: SCHEDULE_TOOL_NAME,
        description: "Records the rows of one schedule, for a person to check before accepting them.",
        input_schema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...SCHEDULE_KINDS] },
            title: { type: ["string", "null"] },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  mark: { type: "string" },
                  description: { type: ["string", "null"] },
                  size: { type: ["string", "null"] },
                  quantity: { type: ["number", "null"] },
                  notes: { type: ["string", "null"] },
                },
                // Required-and-nullable, so "not read" and "not on the drawing"
                // cannot arrive as two different things.
                required: ["mark", "description", "size", "quantity", "notes"],
              },
            },
            reason: { type: "string" },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          },
          required: ["kind", "title", "rows", "reason", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: SCHEDULE_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Sheet page ${params.pageNumber}` +
              (params.sheetTitle ? `, titled "${params.sheetTitle}"` : "") +
              `. The grid follows.`,
          },
          { type: "text", text: params.grid },
        ],
      },
    ],
  });

  // Reported BEFORE the result is checked, through the shared helper rather
  // than a second copy of the rule: a call that produced nothing usable still
  // cost the money, and a bill that counts only successes understates.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") {
    throw new Error("The schedule reader returned no tool call.");
  }
  return parseScheduleRows(block.input);
}

/** Shapes whatever came back into the type, dropping nothing silently that a
 *  person would want to know about. Exported for the eval and its tests. */
export function parseScheduleRows(input: unknown): ScheduleRowsRead {
  const raw = (input ?? {}) as Record<string, unknown>;
  const confidence = raw.confidence === "HIGH" || raw.confidence === "MEDIUM" ? raw.confidence : "LOW";
  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];

  return {
    kind: isScheduleKind(raw.kind) ? raw.kind : "OTHER",
    title: text(raw.title),
    rows: rawRows
      .map((row) => {
        const cells = (row ?? {}) as Record<string, unknown>;
        const mark = text(cells.mark);
        // A ROW WITH NO MARK IS NOT A ROW. The mark is the identity rule 2 is
        // about; without it there is nothing to match against a drawing and
        // nothing a person can check. Dropped rather than given a placeholder,
        // which would become a line item for a door that does not exist.
        if (mark === null) return null;
        return {
          mark,
          description: text(cells.description),
          size: text(cells.size),
          quantity: typeof cells.quantity === "number" && Number.isFinite(cells.quantity) ? cells.quantity : null,
          notes: text(cells.notes),
        };
      })
      .filter((row): row is ScheduleRowRead => row !== null),
    reason: text(raw.reason) ?? "The reading gave no reason, so treat it as unchecked.",
    confidence,
  };
}

function isScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === "string" && (SCHEDULE_KINDS as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
