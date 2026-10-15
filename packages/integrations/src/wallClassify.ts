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
/**
 * Bumped whenever the system prompt changes, because the usage ledger records
 * it and a row that says `.1` must mean the prompt `.1` asked.
 *
 * `.2` (2026-10-13): named the objects a dealership plan draws — vehicles above
 * all, whose body curves pair as neatly as any wall — and added the rule that
 * outlives any list: a wall is two STRAIGHT parallel lines a constant distance
 * apart, and an outline that curves or closes on itself is an object. Also
 * started asking what is MISSING, which is the half no other check here can
 * see.
 *
 * `.3` (2026-10-15): **the word STRAIGHT in `.2` was costing curved walls, and
 * the bench caught it the first time anybody graded this.** On A-101, nine of
 * thirteen real walls dropped were consecutive chords of ONE curved reception
 * wall — a 22ft-radius partition the answer key calls an A1 — each rejected in
 * as many words for being "part of a continuous curve, not a straight run".
 * The rule was written to catch a car's bodywork and it was catching a radius
 * wall, which is a thing architects draw constantly.
 *
 * So `.3` moves the test from HOW IT BENDS to WHAT ITS OUTLINE DOES: an object
 * closes on itself or tapers and stands free; a wall's two faces stay a
 * constant distance apart and END ON OTHER WALLS, whether straight or
 * concentric. Graded before and after by `bench/wallClassify.eval.ts`, which is
 * the only reason this could be changed on evidence rather than on taste.
 */
export const WALL_CLASSIFY_PROMPT_VERSION = "wall-classify.3";

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

/**
 * A wall the drawing shows and the finder did not.
 *
 * WORDS, NEVER A QUANTITY. There is no length, no thickness and no geometry
 * here on purpose: the estimator traces it by hand, and the measurement comes
 * off the drawing the way every other one does. What this carries is the one
 * thing geometry cannot produce — the knowledge that something is absent.
 *
 * It is the half of the job the rest of the pipeline cannot do at all. Every
 * other check in this repo reasons about runs that EXIST; a wall that was never
 * paired is in no list, no cluster and no total, so nothing downstream can
 * notice it. Only looking at the drawing can.
 */
export type MissingWall = {
  /** Where it is, in words an estimator can find on the sheet. */
  where: string;
  /** What makes it a wall, in a few words. */
  why: string;
};

const SYSTEM_PROMPT = `You are helping a drywall and framing subcontractor take off wall quantities from an architectural floor plan.

A deterministic geometry pass has already found candidate runs — pairs of parallel lines a plausible wall thickness apart — and drawn each one in RED with its number beside it. The grey and black linework is the architect's own drawing; dimensions and room tags are usually in blue.

That geometry cannot tell a wall from a countertop, a bathtub, a cabinet run, a door leaf or a dimension line, because all of those are also two parallel lines. You can, by looking at the drawing.

Judge every candidate you are given. Be specific rather than cautious: a countertop called a wall is money on a bid nobody built, and a wall called casework is money left off it. When a run genuinely could be either, say UNSURE rather than guessing — an UNSURE run is kept and flagged for the estimator, so it is the safe answer and not the useless one.

WHAT A WALL LOOKS LIKE, and this rule matters more than the list below because it covers the thing nobody thought of: a wall is drawn as TWO PARALLEL LINES a constant distance apart, running BETWEEN OTHER WALLS or along the building's edge. What makes something an OBJECT rather than a wall is that its outline CLOSES ON ITSELF or TAPERS — a car, a counter, a tub — however neatly two of its edges happen to run parallel for a stretch.

A CURVE IS NOT BY ITSELF AN OBJECT, and this correction is worth more than the rule it qualifies. A radius wall is common and is a wall: two CONCENTRIC faces a constant distance apart, ending where they meet other walls, often drawn as a run of short straight chords. Judge it by whether the two faces stay a constant distance apart and whether its ends land on other walls — not by whether it bends. A curved reception counter is an object because its outline closes and its ends stand free, not because it curves.

Things that are NOT walls, however wall-like they measure: vehicles (a dealership or garage plan draws cars, and their body curves pair beautifully); equipment, machinery and racking; kitchen counters and islands; cabinet, millwork and closet runs; appliances; plumbing fixtures and tubs; stair treads and handrails; furniture and planters; dimension and extension lines; grid lines, leaders and match lines; and anything outside the building's footprint.

AND SAY WHAT IS MISSING. After judging the candidates, look over the drawing again for walls that have NO red line on them at all. Report each one by where it is, in words an estimator can find on the sheet — the room it bounds, the rooms it separates, or the nearest room number. Do not guess a length: somebody will trace it by hand. Missing a wall costs a bid more than keeping a countertop does, and nothing else in this pipeline can see a wall that was never found.`;

export async function labelWallCandidates(params: {
  /** PNG of the crop, base64, with the candidates drawn and numbered on it. */
  imageBase64: string;
  candidates: readonly WallCandidateForLabel[];
  /** What the crop covers, in feet, so the model can judge scale. */
  cropFeet: number;
  onUsage?: ModelUsageReporter;
  /** The model this company's `aiGate` resolved. */
  model?: string;
}): Promise<{ labels: WallLabel[]; missing: MissingWall[] }> {
  if (params.candidates.length === 0) return { labels: [], missing: [] };
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
            missing: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  where: { type: "string" },
                  why: { type: "string" },
                },
                required: ["where", "why"],
                additionalProperties: false,
              },
            },
          },
          // REQUIRED, including when it is empty. A key the model may omit
          // comes back `undefined`, and "found nothing missing" then reads the
          // same as "was not asked" — the distinction this whole repo is built
          // on. An empty array says it looked.
          required: ["labels", "missing"],
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

  // THROWS when there is no tool call, rather than reporting an empty verdict
  // as though the model had looked and found nothing — see
  // `wallClassifyToolCall`.
  const block = wallClassifyToolCall(response.content, response.stop_reason, params.candidates.length);
  const input = block.input as { labels?: unknown; missing?: unknown };
  return {
    labels: readWallLabels(input.labels, params.candidates),
    missing: readMissingWalls(input.missing),
  };
}

/**
 * The missing-wall half of the reply, bounded.
 *
 * Nothing here can move a number, so the only risks are a flood of them on
 * screen and a row that says nothing. Both are capped: at most 25, each field
 * trimmed, and a row with no `where` is dropped — it would put "a wall is
 * missing" in front of somebody with no way to find it.
 */
/**
 * The tool call, or an error saying why there is not one.
 *
 * ── THIS EXISTS BECAUSE THE ABSENCE USED TO READ AS "NOTHING TO REJECT" ──
 *
 * The line here was `if (!block) return { labels: [], missing: [] };`, and on
 * 2026-10-13 that turned a failed check into a clean bill of health on a real
 * drawing. A West Herr floor plan, 216 runs found, the check pressed, sixty
 * seconds of "Checking the runs…", and then **"0 run(s) set aside as casework
 * or reference"** — while the overlay demonstrably held title-block dividers,
 * the company logo, five car outlines and a dozen room-name tags. The estimator
 * was told the machine had looked and found nothing wrong with any of it.
 *
 * A model that returns no tool call has not judged anything. It ran out of
 * output tokens mid-call, or declined, or answered in prose — and every one of
 * those is a FAILURE, which this product already knows how to show: the action
 * marks the allowance, logs metadata and tells the estimator to judge the runs
 * themselves. All of that was sitting unused behind an early return.
 *
 * ── WHY IT IS A SEPARATE PURE FUNCTION ──
 *
 * `labelWallCandidates` builds its own `Anthropic` client, so the path cannot
 * be reached from a test without mocking the SDK. The readers below are
 * exported for exactly that reason and this is the same move: the decision is
 * testable, and the network call around it stays untested, which is the right
 * split.
 *
 * The `stop_reason` rides in the error's NAME rather than its message because
 * the action logs `err.name` and nothing else — metadata only, never the
 * error's text, which can carry a key or a connection string.
 */
export class WallClassifyIncomplete extends Error {
  constructor(stopReason: string | null, asked: number) {
    super(
      `the model returned no ${WALL_CLASSIFY_TOOL_NAME} call for ${asked} candidates (stop_reason: ${stopReason ?? "none"})`,
    );
    this.name = `WallClassifyIncomplete:${stopReason ?? "none"}`;
  }
}

type ToolUseBlock = { type: "tool_use"; name: string; input: unknown };

export function wallClassifyToolCall(
  content: readonly { type: string; name?: string; input?: unknown }[],
  stopReason: string | null,
  asked: number,
): ToolUseBlock {
  const block = content.find((one) => one.type === "tool_use" && one.name === WALL_CLASSIFY_TOOL_NAME);
  if (block === undefined) throw new WallClassifyIncomplete(stopReason, asked);
  return block as ToolUseBlock;
}

export function readMissingWalls(raw: unknown): MissingWall[] {
  if (!Array.isArray(raw)) return [];
  const out: MissingWall[] = [];
  for (const one of raw) {
    if (typeof one !== "object" || one === null) continue;
    const row = one as { where?: unknown; why?: unknown };
    const where = typeof row.where === "string" ? row.where.trim().slice(0, 200) : "";
    if (where === "") continue;
    out.push({ where, why: typeof row.why === "string" ? row.why.trim().slice(0, 200) : "" });
    if (out.length >= 25) break;
  }
  return out;
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
