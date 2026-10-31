import { fingerprint } from "./pastPriceCore";

/**
 * "HOW MANY LAYERS OF BOARD ON THE W2 WALLS?" — the second question the
 * drawings a person measured often do not settle, and one that doubles the
 * board. PURE, like `./wallHeight.ts` (its model): the job guide's loader
 * (`facts.ts`) and the guide's action (`lib/actions/bidGuide.ts`,
 * `setBoardLayers`) both call `boardLayerQuestions` on the rows they read, so
 * the question the screen asked and the one the server re-derives are worked
 * out by one function.
 *
 * ── WHY THIS ONE, AND WHY ONLY THIS ONE ──
 *
 * `wallHeight.ts` records that height was the only wall-type input that could
 * be MISSING. A partition schedule that says "⅝″ Type X each side" and points
 * at a UL detail for the rest leaves the layer count open just as often, and
 * it is the one other answer that moves quantities through the existing
 * bases: board is BOARDED_SQFT (or FACE_SQFT) × factor, and the count is a
 * multiplier on that factor. So `WallType.boardLayers` (nullable, null = not
 * answered) and `WallTypeComponent.perLayer` (this part's factor is for one
 * layer) — see `layerMultiplier` in `lib/wall-assemblies.ts`.
 *
 * Considered and NOT asked, because no answer would change a quantity by code:
 *   - a fire rating: what it changes is WHICH board and which firestopping
 *     detail, and the legend reader already refuses to turn a rating into a
 *     component ("a line item for nothing" — `partitionAssembly.ts`). A
 *     rating that priced something would have to invent the parts it adds.
 *   - "to the deck or above the ceiling": that IS the height question. The
 *     number a person taps for height is the deck or the ceiling-plus-six; a
 *     second question would ask the same thing twice and could contradict it.
 *     A deflection head is a PER_RUN or LINEAR_FT part the sub adds to the
 *     type, not a fact about the run.
 *
 * ── WHEN IT IS ASKED ──
 *
 * A wall type used on this job's runs OR takeoff items, with `boardLayers`
 * still null, that has at least one `perLayer` component. A type with none is
 * never asked: no answer would change anything, and a legend-made type (which
 * writes the layer count into the factor) is exactly that case. The footage is
 * every run and every traced item of the type on this job, since all of their
 * board follows the answer.
 *
 * ── THE ANSWER ──
 *
 * Tap answers: 1 or 2 layers each side, the two that cover nearly every
 * partition. Three or four (shaft and some 2-hour walls) go to the wall-type
 * library, where the person picks it. Written as the TYPE's `boardLayers`
 * through the existing `updateWallType` action, then `refreshWallSchedule` for
 * this job — the same pair the height answer uses — and then this job's
 * takeoff-item lines are re-synced too, so a traced wall's board moves in the
 * same press as a run's (`lib/actions/bidGuide.ts`). It reaches every job using
 * the type, and the confirm says so.
 */

/** The layer counts a person can tap. Anything else is picked in the library. */
export const BOARD_LAYER_CHOICES: readonly number[] = [1, 2];

export type BoardLayerRun = { id: string; wallTypeId: string; lengthFt: number };
/** A takeoff item priced through a wall type. `lengthFt` is its traced length (0 for a non-line). */
export type BoardLayerItem = { id: string; wallTypeId: string; lengthFt: number };
export type BoardLayerType ={ id: string; code: string; sides: number; boardLayers: number | null; perLayerCount: number };

export type BoardLayerQuestion = {
  wallTypeId: string;
  code: string;
  /** 1 or 2 boarded sides — the question says "each side" or "on its one side". */
  sides: number;
  /** Runs of this type on the job. */
  runCount: number;
  /** Takeoff items of this type on the job — traced walls priced through it. */
  itemCount: number;
  /** The runs' length plus the items' traced length, feet. */
  lengthFt: number;
  /** Fingerprint of the question as asked: which type, which runs, which items. */
  token: string;
};

/**
 * Every board-layer question a job has, by wall type code.
 *
 * ── RUNS AND TAKEOFF ITEMS BOTH COUNT ──
 *
 * A wall type prices two kinds of measured wall: wall RUNS (the schedule,
 * `syncWallScheduleLines`) and traced TAKEOFF ITEMS (`syncTakeoffItemLines`),
 * and both multiply a per-layer part by the type's answer. So a type used
 * only through takeoff items is asked about too, and the footage quoted is
 * both. (`wallHeight.ts` is deliberately runs-only: an item carries its own
 * height and never reads the type's default — see `itemGeometry`.)
 *
 * The token covers the type and the exact set of its runs and items here, so
 * an answer to a question that has since changed (a run or an item added or
 * removed) is refused; one already answered elsewhere, or whose type lost its
 * last per-layer part, is not re-derived at all and is refused the same way.
 * A type with no items keeps the token it had before items were counted.
 */
export function boardLayerQuestions(
  runs: readonly BoardLayerRun[],
  items: readonly BoardLayerItem[],
  types: readonly BoardLayerType[],
): BoardLayerQuestion[] {
  const out: BoardLayerQuestion[] = [];
  for (const type of types) {
    if (type.boardLayers != null || type.perLayerCount === 0) continue;
    const typeRuns = runs.filter((run) => run.wallTypeId === type.id);
    const typeItems = items.filter((item) => item.wallTypeId === type.id);
    if (typeRuns.length + typeItems.length === 0) continue;
    const runIds = typeRuns.map((run) => run.id).sort();
    const itemIds = typeItems.map((item) => item.id).sort();
    const itemPart = itemIds.length > 0 ? `|items:${itemIds.join(",")}` : "";
    out.push({
      wallTypeId: type.id,
      code: type.code,
      sides: type.sides === 1 ? 1 : 2,
      runCount: typeRuns.length,
      itemCount: typeItems.length,
      lengthFt: [...typeRuns, ...typeItems].reduce((sum, wall) => sum + wall.lengthFt, 0),
      token: fingerprint(`layers|${type.id}|${runIds.join(",")}${itemPart}`),
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * THE ARG CONTRACT: `bl:<WallType id>:<layers>:<token>`. The count is one of
 * `BOARD_LAYER_CHOICES` — the browser chooses WHICH offered answer, never an
 * arbitrary number (any other count goes through the library's own form).
 */
export function boardLayersArg(question: Pick<BoardLayerQuestion, "wallTypeId" | "token">, layers: number): string {
  return `bl:${question.wallTypeId}:${layers}:${question.token}`;
}

export function parseBoardLayersArg(arg: unknown): { wallTypeId: string; layers: number; token: string } | null {
  if (typeof arg !== "string") return null;
  const m = /^bl:([A-Za-z0-9_-]{1,64}):(\d):([0-9a-f]{8})$/.exec(arg.trim());
  if (!m) return null;
  const layers = Number(m[2]);
  if (!BOARD_LAYER_CHOICES.includes(layers)) return null;
  return { wallTypeId: m[1]!, layers, token: m[3]! };
}
