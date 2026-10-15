import Anthropic from "@anthropic-ai/sdk";
import { reportUsage, type ModelUsageReporter } from "./anthropic";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";

/**
 * ── READING THE WORDS OFF A SCANNED DRAWING ──
 *
 * A scanned sheet has no text layer. `rasterStrokes.ts` recovers its LINES
 * from the pixels, deterministically, because geometry on this product is
 * computed by code and never by a model. The words are the other half, and
 * they are the half a model is actually for: deciding that a smudge of ink
 * says `1/4" = 1'-0"` is interpretation, which is exactly the division
 * ARCHITECTURE.md draws.
 *
 * **What this returns is TEXT AND WHERE IT SITS, and nothing else.** No
 * length, no area, no quantity. A dimension string's VALUE is read here; the
 * line it belongs to is measured by code, and the scale is their quotient. So
 * no number a customer is billed from ever comes out of a model, and that
 * stays true even though a model is now reading the drawing.
 *
 * **It reads a TILE, not a sheet.** A 36-inch sheet asked about whole is a
 * thumbnail by the time it reaches the model, and the coordinates come back
 * accordingly. Tiling keeps the resolution up and — the part that matters —
 * means the model only has to be accurate WITHIN a small window, because the
 * window's own offset on the page is known exactly. `scaleFromDimensions`
 * pairs a label with a line only if it sits within 30 points of it, which is
 * about one percent of an ARCH D width and a twentieth of a tile.
 */

export const SHEET_TEXT_TOOL_NAME = "report_text";
export const SHEET_TEXT_PROMPT_VERSION = "sheet-text.1";

/** Where a piece of text sits, as a fraction of the TILE, origin top left. */
export type TextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const SYSTEM_PROMPT = `You read the lettering off a crop of an architectural drawing.

Report EVERY piece of text you can read, exactly as printed. Keep the
punctuation that carries meaning on a drawing: feet and inch marks, fractions,
the equals sign in a scale note, the colon in a metric ratio. "24'-6 1/2"" is
not "24 6 1/2", and "1/4" = 1'-0"" is not "1/4 = 1-0".

Group each line of lettering as ONE item. A room tag printed as a name over a
number is two items, because they are two lines.

For each item give a box as FRACTIONS OF THIS CROP: x and y are its top-left
corner, width and height its size, each between 0 and 1, with x to the right
and y downward. Be as precise as you can — the box is used to decide which
dimension line a number belongs to, and a number placed against the wrong line
produces a wrong measurement on every quantity taken off the drawing.

Report text only. Do not describe the drawing, do not report what the lines
appear to be, and do not guess at anything you cannot actually read. If a
piece of lettering is illegible, leave it out rather than inventing it.`;

export async function readSheetTextTile(params: {
  /** PNG of one tile, base64. */
  imageBase64: string;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
  /**
   * The image's media type.
   *
   * JPEG by default and that is deliberate: this reads SCANS, and a scan's
   * speckle is the worst case for PNG — the same tile measured 1.20 MB as PNG
   * and 0.54 MB as JPEG. Smaller is twice useful, since the payload has to
   * cross a Server Action's body limit and the image's own tokens are most of
   * what the call costs.
   */
  mediaType?: "image/jpeg" | "image/png";
}): Promise<{ boxes: TextBox[]; reported: number }> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const response = await client.messages.create({
    model: params.model ?? modelFor("SHEET_TEXT").model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: SHEET_TEXT_TOOL_NAME,
        description: "Report every piece of text in the crop, with its box.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Exactly as printed." },
                  x: { type: "number", description: "Left edge, 0-1 across the crop." },
                  y: { type: "number", description: "Top edge, 0-1 down the crop." },
                  width: { type: "number", description: "Width, 0-1." },
                  height: { type: "number", description: "Height, 0-1." },
                },
                required: ["text", "x", "y", "width", "height"],
              },
            },
          },
          required: ["items"],
        },
      },
    ],
    tool_choice: { type: "tool", name: SHEET_TEXT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: params.mediaType ?? "image/jpeg", data: params.imageBase64 },
          },
          { type: "text", text: "Report every piece of text in this crop." },
        ],
      },
    ],
  });

  await reportUsage(params.onUsage, response.usage);

  // ── WHAT THE MODEL SAID, BESIDE WHAT SURVIVED THE CHECKS ──
  //
  // "Read 0 words off this sheet" has two completely different causes and one
  // sentence: the model found nothing on a blank or unreadable tile, or it
  // found plenty and every box was thrown away for being outside the crop.
  // One is a rendering problem, the other a coordinate problem, and a caller
  // that cannot tell them apart has to guess. Reported separately so it never
  // has to.
  const raw = response.content.find((c) => c.type === "tool_use")?.input;
  return { boxes: readTextBoxes(raw), reported: countReportedBoxes(raw) };
}

/**
 * SEPARATE AND EXPORTED so the parsing can be tested without a model.
 *
 * Everything here is a reply from outside this program, so every field is
 * checked rather than trusted. A box outside the crop, a missing number or a
 * blank string is DROPPED rather than clamped: a fabricated coordinate placed
 * at an edge would pair with whatever line happens to be there, and a quietly
 * wrong pairing is worse than a missing one.
 */
/**
 * How many items the model CLAIMED, before any of them were checked.
 *
 * Deliberately almost no validation: this is the denominator for "and how many
 * of those were usable", so anything stricter would hide the very gap it
 * exists to show.
 */
export function countReportedBoxes(raw: unknown): number {
  if (raw === null || typeof raw !== "object") return 0;
  const items = (raw as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : 0;
}

export function readTextBoxes(raw: unknown): TextBox[] {
  if (raw === null || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const out: TextBox[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text.length === 0) continue;
    const num = (k: string) => (typeof row[k] === "number" && Number.isFinite(row[k]) ? (row[k] as number) : null);
    const x = num("x");
    const y = num("y");
    const width = num("width");
    const height = num("height");
    if (x === null || y === null || width === null || height === null) continue;
    if (width <= 0 || height <= 0) continue;
    if (x < -0.05 || y < -0.05 || x + width > 1.05 || y + height > 1.05) continue;
    out.push({ text, x, y, width, height });
  }
  return out;
}
