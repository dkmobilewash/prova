import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * ── READING A PARTITION LEGEND BY SIGHT ──
 *
 * `wallLegend.ts` reads the legend from the page's TEXT, and on a legend drawn
 * as section details that is half the drawing: Baker's S6B says "2x STEEL
 * FRAMING, SEE STRUCTURAL" in words and draws a 6in stud; four of its eight
 * types read as "no assembly could be read from its words". The stud is in the
 * picture, the layer count is in the hatching, the rating is in a box the text
 * pass sees as a stray cell.
 *
 * So this is given the drawing too: the legend page at reading resolution, one
 * crop per wall type, and the same text lines — and asked for the FIELDS an
 * estimator needs rather than for the lines, each with where it came from.
 * Quantities only: nothing here is a price, and the caller turns the fields
 * into components with the same builder the text read uses.
 *
 * The prompt version is in the cache key, so changing the prompt costs one
 * call per set and never reads a stale answer. Version 2 added the tag-key
 * rule: Baker's A601 carries a "WALL TAG LEGEND" decoding `XC#A` — C the
 * core material, # its size — so S6B's 6in stud is on the sheet after all,
 * in the key rather than the detail. Version 1, shown a crop that cut the
 * notes off, read it from the letters and could not say why; shown the
 * notes, it said "not stated". Both were wrong about where the answer was.
 * Version 3 added three rules from the v2 contact sheets: ELEVEN03's legend
 * is a table of tag, thumbnail, UL number and rating, and the model filled in
 * studs and board from what it knows U465 contains; NG Green Bay prints each
 * code UNDER its detail, so a crop cut below the code showed the next type's
 * section and the model read that; Crosslines' crops took in the neighbouring
 * detail's batts and four types gained insulation they do not have.
 * Version 4: a numbered detail's NUMBER is its code (E Street tags walls
 * `2`, and the sight read called it "WALL TYPE 1"); a field filled from a
 * sheet-wide note is named as such (SW's seven types got their board from
 * one note on the stud chart); and OPTIONAL items are listed, never counted.
 * Version 5: a legend entry that is a storefront, curtain wall, glazing,
 * railing or door says so in `notAPartition` instead of coming back as
 * nothing (Nall's SF-1 and SF-2 came back as nothing). Version 6 scopes
 * that to the legend ENTRY: v5 let the model call SW's A1–B3 "stud size
 * chart" and "door jamb detail" because their crops had landed on detail
 * bubbles sharing those numbers, and seven read types became none.
 */
export const WALL_LEGEND_SIGHT_PROMPT_VERSION = "wall-legend-sight.6";

const TOOL_NAME = "record_wall_types_by_sight";

export type WallTypeSight = {
  code: string;
  name: string | null;
  /** Stud width in inches, or null; from the drawn section or its note. */
  studWidthIn: number | null;
  studMaterial: "metal" | "wood" | "masonry" | "concrete" | "other" | null;
  studGauge: number | null;
  studSpacingIn: number | null;
  boardThicknessIn: number | null;
  /** Layers of board on each side; a one-sided wall has 0 on one side. */
  layersSideA: number | null;
  layersSideB: number | null;
  boardIsTypeX: boolean | null;
  insulation: string | null;
  hourlyRating: number | null;
  heightNote: string | null;
  /** The drawing's own words for this type, verbatim, as read off the crop. */
  notes: string[];
  /** Which fields were read from the PICTURE rather than the text. */
  fromDrawing: string[];
  /** Fields taken from a note that applies to EVERY type on the sheet, not this type's own words. */
  fromSheetNote: string[];
  /** Items the drawing marks optional or alternate, verbatim; never counted. */
  optional: string[];
  /**
   * Set when the "type" is not a framed or masonry partition at all — a
   * storefront, curtain wall, glazing, railing, or a door — with the word
   * the drawing uses. Such a type is reported, never proposed.
   */
  notAPartition: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type WallLegendSightRead = {
  types: WallTypeSight[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You are reading a PARTITION LEGEND off a construction drawing for a framing and drywall subcontractor preparing a bid. You are given the legend page as an image, one close-up crop per wall type, and every line of the page's text.

For EACH wall type named, record the fields below. Read the DRAWING as well as the words: a wall section shows its stud as a rectangle or C-shape whose width is dimensioned or labelled, its board as lines on each face (count them per side), its insulation as a zigzag or batt hatch, and its rating in a box or note. Where the text says "SEE STRUCTURAL" the drawing often still shows the size.

Rules:
1. A type's CODE is what the drawing calls it, copied exactly. If a crop shows no code, leave that type out.
2. Record a field ONLY when the drawing or its notes state it. null means "not stated", never "probably". A stud width you infer from a dimension string is stated; one you guess from the drawing's proportions is NOT — leave it null and say so in the reason.
   A TAG KEY counts as stating it. Many legends carry a key explaining what each letter and digit of a code means — for example "S = steel stud, 6 = 6in, 8 = 8in", or "X prefix = rated". A size or material decoded through such a key on this sheet IS stated: record it, and name "tagKey" in fromDrawing so a reader knows where it came from. Without a key on the sheet, do not decode a code's letters.
3. layersSideA and layersSideB are the number of board layers on each face. A wall boarded on one side only has 0 on the other. If the drawing shows layers but the text does not count them, count the lines on each face and name "layers" in fromDrawing.
4. fromDrawing lists the field names you took from the picture rather than from any text: for example ["studWidthIn", "layersSideA"].
5. notes are the type's own words, verbatim, in reading order, as they appear in its crop — not the whole page.
6. Never invent a price, a product name that is not printed, or a height; heightNote is the printed words about height ("TO DECK", "SEE NOTE A", "10'-0\\"") or null.
7. insulation is the printed words ("R-13 BATT", "SOUND ATTENUATION BATTS") or null. hourlyRating is the number of hours (0 for a printed NON-RATED), or null when nothing says.
8. A UL or GA design number (U465, WP 1070) states NOTHING about studs, board or insulation by itself. Do not fill fields from what you know such a design contains; a legend that gives only a tag, a thumbnail and a UL number has stated only the rating. Leave the rest null and say so in the reason.
9. A crop is cut around the type's printed code and may show parts of NEIGHBOURING types above, below or beside it. Use only the notes whose leaders point into THIS type's own section, and the words on its own title line. The code may be printed above its detail or below it; find the detail the code labels before reading anything.
10. Where a note names a board "EACH SIDE" or "BOTH SIDES", layersSideA and layersSideB are equal; do not count a hatch on one face as the only layer.
11. THE CODE IS WHAT THE PLANS POINT AT. When the types are numbered DETAILS on a details sheet — a detail bubble with a number and the sheet beneath it, titled "WALL TYPE 1 – NON-RATED" — the plans tag walls with the DETAIL NUMBER, so record that number as the code ("2") and put the title in name. Only where there is no detail number is the title's own code the code.
12. A note that applies to the WHOLE SHEET — "all studs assumed to have 5/8in gyp bd on both faces", a general note numbered at the margin — is weaker than the type's own words. You may fill a field from it, but name that field in fromSheetNote and quote the note in notes, so the reader sees it was not said of this type.
14. A legend entry that is not a wall assembly — a STOREFRONT, CURTAIN WALL, GLAZING or WINDOW system, a RAILING, a DOOR — still gets a record, with notAPartition set to the drawing's own word for it ("storefront") and the assembly fields null. It is reported so nobody wonders where it went; it is never proposed as a partition.
    notAPartition describes what the LEGEND ENTRY is, never what a crop happens to show. A crop is cut around a printing of the code and can land on a detail bubble, a grid line or a chart that shares the code's letters; if the crop shows something that is not the type, ignore the crop, read the type from the page and its text, and leave notAPartition null. Set it only when the legend's own words for that type say it is a storefront, curtain wall, glazing, railing, door, or an existing wall not being built.
13. Anything the drawing marks OPTIONAL, ALTERNATE, "or", "where indicated", or "if required" — an optional batt, an alternate board — goes in optional, verbatim, and NOT in insulation, boardThicknessIn or the layer counts. An optional item is not part of the assembly.

Record everything through the ${TOOL_NAME} tool. The reason says, in two or three sentences, what the legend looks like and where you had to judge.`;

export async function extractWallLegendBySight(params: {
  /** The legend page, at reading resolution. */
  page: { imageBase64: string; mediaType: "image/png" | "image/jpeg" };
  /** One crop per expected wall type, by its code. */
  crops: { code: string; imageBase64: string; mediaType: "image/png" | "image/jpeg" }[];
  /** Every line of the page's text, in reading order. */
  lines: readonly string[];
  pageNumber: number;
  sheetTitle?: string | null;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<WallLegendSightRead> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text:
        `Sheet ${params.pageNumber}` +
        (params.sheetTitle ? `, titled "${params.sheetTitle}"` : "") +
        `. The whole page first, then one crop per wall type (${params.crops.map((c) => c.code).join(", ")}), then the page's text.`,
    },
    { type: "image", source: { type: "base64", media_type: params.page.mediaType, data: params.page.imageBase64 } },
  ];
  for (const crop of params.crops) {
    content.push({ type: "text", text: `Crop around wall type ${crop.code}:` });
    content.push({ type: "image", source: { type: "base64", media_type: crop.mediaType, data: crop.imageBase64 } });
  }
  content.push({ type: "text", text: `The page's text, in reading order:\n\n${params.lines.join("\n")}` });

  const response = await client.messages.create({
    model: params.model ?? modelFor("PLAN_TEXT_READ").model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Records each wall type's assembly as read from the legend's drawing and notes, for a person to check.",
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
                  studWidthIn: { type: ["number", "null"] },
                  studMaterial: { type: ["string", "null"], enum: ["metal", "wood", "masonry", "concrete", "other", null] },
                  studGauge: { type: ["number", "null"] },
                  studSpacingIn: { type: ["number", "null"] },
                  boardThicknessIn: { type: ["number", "null"] },
                  layersSideA: { type: ["number", "null"] },
                  layersSideB: { type: ["number", "null"] },
                  boardIsTypeX: { type: ["boolean", "null"] },
                  insulation: { type: ["string", "null"] },
                  hourlyRating: { type: ["number", "null"] },
                  heightNote: { type: ["string", "null"] },
                  notes: { type: "array", items: { type: "string" } },
                  fromDrawing: { type: "array", items: { type: "string" } },
                  fromSheetNote: { type: "array", items: { type: "string" } },
                  optional: { type: "array", items: { type: "string" } },
                  notAPartition: { type: ["string", "null"] },
                  confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                },
                required: ["code", "notes", "fromDrawing", "confidence"],
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
    messages: [{ role: "user", content }],
  });

  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((one) => one.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") throw new Error("The model returned no legend reading.");
  return parseSightRead(block.input);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
const conf = (v: unknown): "HIGH" | "MEDIUM" | "LOW" => (v === "HIGH" || v === "MEDIUM" || v === "LOW" ? v : "LOW");

/** SEPARATE AND EXPORTED so the parsing can be tested without a model. */
export function parseSightRead(input: unknown): WallLegendSightRead {
  const raw = (input ?? {}) as { types?: unknown; reason?: unknown; confidence?: unknown };
  const material = (v: unknown): WallTypeSight["studMaterial"] =>
    v === "metal" || v === "wood" || v === "masonry" || v === "concrete" || v === "other" ? v : null;
  const types: WallTypeSight[] = (Array.isArray(raw.types) ? raw.types : [])
    .map((one): WallTypeSight => {
      const t = (one ?? {}) as Record<string, unknown>;
      return {
        code: str(t.code) ?? "",
        name: str(t.name),
        studWidthIn: num(t.studWidthIn),
        studMaterial: material(t.studMaterial),
        studGauge: num(t.studGauge),
        studSpacingIn: num(t.studSpacingIn),
        boardThicknessIn: num(t.boardThicknessIn),
        layersSideA: num(t.layersSideA),
        layersSideB: num(t.layersSideB),
        boardIsTypeX: typeof t.boardIsTypeX === "boolean" ? t.boardIsTypeX : null,
        insulation: str(t.insulation),
        hourlyRating: num(t.hourlyRating),
        heightNote: str(t.heightNote),
        notes: strings(t.notes),
        fromDrawing: strings(t.fromDrawing),
        fromSheetNote: strings(t.fromSheetNote),
        optional: strings(t.optional),
        notAPartition: str(t.notAPartition),
        confidence: conf(t.confidence),
      };
    })
    .filter((t) => t.code !== "");
  return { types, reason: str(raw.reason) ?? "", confidence: conf(raw.confidence) };
}
