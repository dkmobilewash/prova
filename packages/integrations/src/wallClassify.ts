import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * ── WHAT EACH CANDIDATE RUN ACTUALLY IS ──
 *
 * `wallsFromStrokes` finds two parallel lines a wall-thickness apart and
 * measures the distance between them. That measurement is exact and stays
 * deterministic: the lengths and thicknesses in a bid come out of the drawing's
 * own geometry, never out of a model. This asks a different question, the one
 * geometry cannot answer — IS IT A WALL.
 *
 * ── WHY A MODEL AND NOT ANOTHER RULE ──
 *
 * A countertop is two parallel lines a counter-depth apart. So is a bathtub, a
 * closet shelf, a cabinet run and a dimension string. They pass every test the
 * finder has — parallel, overlapping, in the thickness window, long enough —
 * because those tests describe a SHAPE and the difference here is MEANING.
 *
 * Measured on a real 175-page permit set, on one apartment floor plan: of 98
 * candidates in one crop the geometry was right about the walls and also
 * returned every kitchen counter, every bathtub, every refrigerator run and
 * five long reference lines below the building. The same crop, shown to a model
 * with the candidate list, came back with the counters, the tubs, the vanities
 * and all five reference lines rejected and the building's structure intact —
 * 200 ft of 774 removed, with no real wall among the removals.
 *
 * Rules for those were tried first and the honest result is in this repo's
 * history: each one was fitted to the drawings in front of it and broke on the
 * next office's conventions. "Reject a closed outline" deletes every wall on a
 * plan that draws walls as filled poché.
 *
 * ── A CROP, NOT THE SHEET ──
 *
 * `planSheets.ts` explains why it reads text and never an image: an ARCH D page
 * is 36 inches wide, and fitted to the model's 2,576px long edge that is about
 * 65 DPI, which makes 1/8in lettering eight pixels tall. The same arithmetic is
 * why this takes a CROP. A 600pt window rendered at 1,600px is roughly 190 DPI,
 * so the room tags, the fixture outlines and the candidate numbers are all
 * legible — and legible is the whole job here, because the labels on the
 * drawing are what separate a kitchen from a corridor.
 *
 * ── IT CANNOT INVENT FOOTAGE ──
 *
 * The reply is a label per id and nothing else. It cannot change a length, move
 * a run or add one: every id it answers about already exists with its quantity
 * measured, and an id it does not answer about is left as the geometry found
 * it. The worst a wrong answer can do is drop a real wall or keep a countertop,
 * both of which are visible on screen in the colour of the run, and both of
 * which a person can overrule.
 */

export const WALL_CLASSIFY_TOOL_NAME = "label_candidates";
export const WALL_CLASSIFY_PROMPT_VERSION = "wall-classify.1";

/** What a candidate turned out to be. */
export const WALL_CLASSIFY_LABELS = ["WALL", "CASEWORK", "REFERENCE", "UNSURE"] as const;
export type WallClassifyLabel = (typeof WALL_CLASSIFY_LABELS)[number];

export type WallCandidateForLabel = {
  /** 1-based, and the number drawn beside the run in the image. */
  id: number;
  thicknessIn: number;
  lengthFt: number;
};

export type WallLabel = {
  id: number;
  label: WallClassifyLabel;
  /** Why, in a few words, for the estimator rather than for the log. */
  reason: string;
};

const SYSTEM_PROMPT = `You are helping a drywall and framing subcontractor take off wall quantities from an architectural floor plan.

A deterministic geometry pass has already found candidate runs — pairs of parallel lines a plausible wall thickness apart — and drawn each one in RED with its number beside it. The grey and black linework is the architect's own drawing; dimensions and room tags are usually in blue.

That geometry cannot tell a wall from a countertop, a bathtub, a cabinet run, a door leaf or a dimension line, because all of those are also two parallel lines. You can, by looking at the drawing.

Judge every candidate you are given. Be specific rather than cautious: a countertop called a wall is money on a bid nobody built, and a wall called casework is money left off it. When a run genuinely could be either, say UNSURE rather than guessing — an UNSURE run is kept and flagged for the estimator, so it is the safe answer and not the useless one.

Things that are NOT walls, however wall-like they measure: kitchen counters and islands, cabinet and closet runs, appliances, plumbing fixtures and tubs, stair treads and handrails, furniture, dimension and extension lines, grid lines, leaders, match lines, and anything outside the building's footprint.`;

export async function labelWallCandidates(params: {
  /** PNG of the crop, base64, with the candidates drawn and numbered on it. */
  imageBase64: string;
  candidates: readonly WallCandidateForLabel[];
  /** What the crop covers, in feet, so the model can judge scale. */
  cropFeet: number;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<WallLabel[]> {
  if (params.candidates.length === 0) return [];
  const client = new Anthropic(AI_CLIENT_OPTIONS);

  const list = params.candidates
    .map((one) => `${one.id}: ${one.thicknessIn.toFixed(2)}in thick, ${one.lengthFt.toFixed(1)}ft long`)
    .join("\n");

  const response = await client.messages.create({
    model: params.model ?? modelFor("WALL_CLASSIFY").model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: WALL_CLASSIFY_TOOL_NAME,
        description:
          "Records what each candidate run actually is, for the estimator to check before any of it is priced.",
        input_schema: {
          type: "object",
          properties: {
            labels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  label: { type: "string", enum: [...WALL_CLASSIFY_LABELS] },
                  reason: { type: "string" },
                },
                required: ["id", "label", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["labels"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: WALL_CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: params.imageBase64 } },
          {
            type: "text",
            text: `This crop covers about ${Math.round(params.cropFeet)} feet across.\n\nThe ${params.candidates.length} candidates on it, as the geometry measured them:\n${list}\n\nLabel every one of them.`,
          },
        ],
      },
    ],
  });

  // REPORTED BEFORE THE RESULT IS READ, the rule `anthropic.ts` states: a call
  // that produced nothing usable still cost the money.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find(
    (one): one is Extract<typeof one, { type: "tool_use" }> =>
      one.type === "tool_use" && one.name === WALL_CLASSIFY_TOOL_NAME,
  );
  if (!block) return [];
  return readWallLabels((block.input as { labels?: unknown }).labels, params.candidates);
}

/**
 * The reply, reduced to labels the caller can act on.
 *
 * SEPARATE AND EXPORTED so it can be tested without a model: everything that
 * can go wrong with an answer goes wrong here, and none of it needs a network
 * call to demonstrate.
 *
 * What it refuses, and why each one matters to a quantity:
 *
 *   - AN ID NOBODY ASKED ABOUT. The caller keys its runs by id, so a label for
 *     a run that is not in this crop applies to nothing — or worse, to whatever
 *     happens to hold that index.
 *   - A SECOND ANSWER FOR ONE ALREADY GIVEN, which would make the verdict
 *     depend on iteration order.
 *   - A LABEL OUTSIDE THE FOUR. An unrecognised string must not fall through to
 *     a default: the two defaults available are "drop the run" and "keep the
 *     run", and both are a decision this never made.
 *
 * A run with no usable answer is simply absent from the result, and the caller
 * leaves such a run exactly as the geometry found it — which is the safe
 * direction for a quantity nobody has accepted yet.
 */
export function readWallLabels(
  raw: unknown,
  candidates: readonly WallCandidateForLabel[],
): WallLabel[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(candidates.map((one) => one.id));
  const seen = new Set<number>();
  const labels: WallLabel[] = [];
  for (const one of raw) {
    // A ROW THAT IS NOT AN OBJECT IS SKIPPED, not read. `null` is typeof
    // "object", so the obvious check is not enough and reading `.id` off it
    // throws — which would turn one malformed row into a failed call, a marked
    // allowance and an error on screen, instead of one run left alone.
    if (typeof one !== "object" || one === null) continue;
    const row = one as { id?: unknown; label?: unknown; reason?: unknown };
    const id = typeof row.id === "number" ? row.id : Number.NaN;
    if (!known.has(id) || seen.has(id)) continue;
    const label = WALL_CLASSIFY_LABELS.find((candidate) => candidate === row.label);
    if (!label) continue;
    seen.add(id);
    labels.push({
      id,
      label,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 200) : "",
    });
  }
  return labels;
}
