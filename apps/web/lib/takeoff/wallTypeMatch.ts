import type { TaggedFeet } from "./wallTags";

/**
 * THE LAST LINK BETWEEN A DETECTED WALL AND A PRICED LINE.
 *
 * Everything either side of this already existed. The finder returns groups by
 * thickness and `wallTags.ts` already reads the drawing's own labels and says
 * which runs carry which — so the app has known "this 4⅞″ group is tagged W1"
 * and shown it on screen, while the estimator picked the wall type by hand for
 * every group anyway. This closes it.
 *
 * ── WHY THE TAG AND NOT THE THICKNESS ──
 *
 * The drawing already says which wall is which. `WallType.code` is the same
 * designation the drafter printed beside the wall. So this is an IDENTITY
 * match, not a similarity score, and that is the whole reason it can be trusted
 * enough to price from.
 *
 * **HALF OF WHAT THIS PARAGRAPH USED TO SAY IS NOW FALSE, AND IT WAS TRUE WHEN
 * IT WAS WRITTEN.** It read: *"The obvious design is to match a detected
 * thickness against the wall type's thickness. It is not available and should
 * not be invented: `WallType` has `code`, `name`, `defaultHeightFt`, `sides`
 * and `studSpacingIn` — NO thickness — and deriving one from its components
 * means parsing '⅝″ Type X' out of a description, which is a guess wearing a
 * measurement's clothes."*
 *
 * Every word of that was accurate until #731, which added
 * `WallType.thicknessIn` and fills it by reading the sheet's own partition
 * schedule — so the thickness is neither absent nor inferred from a
 * description. It is what the architect wrote in a table.
 *
 * **The other half of the paragraph survives intact and is the load-bearing
 * half:** *"Two types also routinely share a thickness and differ in rating and
 * layers, so thickness cannot identify a type even in principle."* Still true,
 * and School-01 proves it — A1 and A2 are both 4-7/8" there, differing by fire
 * rating, which a floor plan cannot show.
 *
 * So thickness is a SHORTLIST and never an identity. `wallGroups.ts` uses it
 * that way: tag first, thickness only where the drawing was silent, and a
 * question rather than a guess where two types share one. This module is
 * unchanged in what it does — it still matches by tag alone.
 *
 * ── IT REFUSES MORE THAN IT MATCHES, AND THAT IS THE DESIGN ──
 *
 * This produces a priced line on a GC-facing bid. So every outcome short of one
 * unambiguous tag naming one of the company's own types is a refusal that SAYS
 * WHAT IS MISSING, because the estimator can act on each of them differently:
 *
 *   NO_TAG       the drawing named nothing in this group. Pick a type by hand.
 *   NO_SUCH_TYPE the drawing says W1 and this company has no W1 with layers.
 *                That is the actionable one — the partition schedule on the
 *                sheet usually says what W1 is, and `SCHEDULE_ROWS` has already
 *                read it.
 *   MIXED        more than one name, with no clear majority. The group spans
 *                two types that share a thickness, and pricing it as either
 *                prices part of it wrong.
 *
 * Nothing here applies anything. It returns a proposal for one group, which the
 * person accepts with that group drawn on the sheet in front of them — the same
 * posture as the scale prefill and the sheet index.
 */

/**
 * A wall type this matcher may NAME a group with.
 *
 * ── IT USED TO MEAN "POSTABLE", AND THAT COST THE SCHEDULE IMPORT ──
 *
 * This was `PostableWallType`, and the takeoff page handed the matcher a list
 * filtered to `components: { some: {} }` — types with layers. The reasoning was
 * sound about POSTING: a layerless type produces no line items, so posting a
 * group as one adds nothing to the estimate and loses the quantities it
 * replaced. It was wrong about NAMING, which is a different question.
 *
 * Measured on School-01, 2026-10-11. The partition schedule was read off A-501
 * and ten wall types were created from it — A1, A2, B1, C1, D1, F1, EXT-1,
 * EXT-2, CMU, SF — each with the thickness the drawing prints. Then **Find the
 * walls** on A-101 found 63 runs, tagged them A1 and A2 off the drawing, and
 * reported "no wall type you have is 4-7/8 inch thick" beside a row the app had
 * just tagged A1. Both sentences were true of the list it was given, and the
 * import's own button promises the opposite: "Each one arrives with its
 * thickness, so a wall measured on the drawing can find it."
 *
 * So the gate moved to where the constraint actually is. The matcher sees every
 * type and may name any of them; `hasParts` is what the viewer reads to decide
 * whether a group can be POSTED PRICED, and `postMeasuredWallRun` refuses a
 * layerless type server-side regardless — a form can send anything.
 */
export type MatchableWallType = {
  id: string;
  code: string;
  name: string;
  /**
   * Whether this type has layers, and therefore produces line items.
   *
   * NOT A FILTER ANY MORE, A FACT ON THE ROW. A type without parts can still
   * tell an estimator what the drawing's "A1" means — which is most of the
   * value of reading the schedule — and the screen says what is missing rather
   * than the group going unnamed for a reason nothing states.
   */
  hasParts: boolean;
  /**
   * What tells this type from its neighbours at the same thickness, in a
   * few words — "board both sides · 2 layers · 2 HR" — built by
   * `wallTypeSummary` from the sides, the parts and the notes. S6B and S6C on
   * Baker are both "NON-RATED INTERIOR WALL" at 7-1/4"; the summary is the
   * only thing on the row that says one is boarded one side and the other
   * both. Optional, because the stored-proposal read-back has no parts to
   * build it from.
   */
  summary?: string;
  /** The height a run of this type is priced at when none is typed; null means the panel must ask for one. */
  defaultHeightFt?: number | null;
  /**
   * Finish to finish, in inches, where the company has recorded one — #731.
   *
   * NULLABLE AND IT STAYS NULLABLE. A type typed in by hand before that column
   * existed has none, and backfilling one by inference would be the guess the
   * header above describes. Null means "cannot be matched by thickness", which
   * is what `typesAtThickness` reads it as, so an old library quietly keeps the
   * behaviour it had rather than acquiring a wrong answer.
   */
  thicknessIn: number | null;
  /**
   * The partition legend's own "unless noted otherwise" sentence naming this
   * type as the default — Joplin's G-111: "ALL INTERIOR DRYWALL PARTITIONS …
   * ARE TYPE 'A' PARTITIONS". A floor plan carries no such note of its own
   * there, so `defaultWallTypeFromNotes` falls back to this.
   */
  unoNote?: string | null;
};

export type WallTypeMatch =
  | { state: "MATCH"; type: MatchableWallType; tag: string; feet: number; share: number }
  | { state: "NO_TAG" }
  | { state: "NO_SUCH_TYPE"; tag: string }
  | { state: "MIXED"; tags: string[] };

/**
 * How much of a group's TAGGED footage must carry one name before that name
 * identifies the group.
 *
 * Not 1.0, because a single run picking up a neighbouring room's tag should not
 * cost the estimator the whole group — `tagByRun` assigns by proximity and a
 * corner run genuinely sits near two labels. Not 0.5 either: a bare majority of
 * a group spanning two types still prices the minority wrong, and this writes
 * to a bid.
 *
 * 0.85 is the judgement, and the test beside it is what makes it a decision
 * rather than a number: a 50/50 group refuses, a 90/10 group matches, and the
 * 10% is named on screen so nobody is surprised by it later.
 */
export const TAG_MAJORITY = 0.85;

/** Compare a drawing's label with a company's code.
 *
 * Upper-cased with non-alphanumerics removed, so "W-1", "W 1" and "w1" are the
 * same designation — which they are on every drawing anybody has sent us. It
 * goes no further than that deliberately: stripping digits or collapsing
 * letters would make "W1" match "W11", and that is a different wall at a
 * different price. */
export function sameDesignation(a: string, b: string): boolean {
  const normal = (one: string) => one.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const left = normal(a);
  return left !== "" && left === normal(b);
}

export function matchClusterToWallType(
  tagged: readonly TaggedFeet[],
  wallTypes: readonly MatchableWallType[],
): WallTypeMatch {
  // `one.feet > 0` is REDUNDANT against the total guard below, and kept:
  // mutation confirms removing it changes no answer, because a set of
  // zero-footage tags sums to zero and falls through there anyway. It stays
  // because it states the intent where the filter is read — a tag with no
  // length names nothing — rather than leaving that to arithmetic two lines
  // down. Noted so the next reader does not spend a mutation on it.
  const named = tagged.filter((one) => one.name.trim() !== "" && one.feet > 0);
  if (named.length === 0) return { state: "NO_TAG" };

  const total = named.reduce((sum, one) => sum + one.feet, 0);
  if (!(total > 0)) return { state: "NO_TAG" };

  // `taggedFeetForClusters` sorts by feet, so the first is the dominant name —
  // but this does not rely on that, because a caller assembling the list by
  // hand would then get a silently different answer.
  const leader = named.reduce((best, one) => (one.feet > best.feet ? one : best), named[0]);
  const share = leader.feet / total;
  if (share < TAG_MAJORITY) {
    return { state: "MIXED", tags: named.map((one) => one.name) };
  }

  const type = wallTypes.find((one) => sameDesignation(one.code, leader.name));
  if (!type) return { state: "NO_SUCH_TYPE", tag: leader.name };

  return { state: "MATCH", type, tag: leader.name, feet: leader.feet, share };
}

/**
 * What to put on the button and beside it.
 *
 * The sentence names the TYPE's own code and name rather than echoing the tag,
 * so an estimator can see the app matched the drawing to the right thing — "the
 * drawing says W1 and your W1 is ⅝″ Type X both sides" is checkable, and "W1
 * matched" is not.
 */
export function matchSentence(match: WallTypeMatch): string | null {
  switch (match.state) {
    case "MATCH": {
      const rest =
        match.share < 1
          ? ` ${Math.round(match.share * 100)}% of the tagged length here is ${match.tag}; the rest will be priced as it too.`
          : "";
      return `The drawing tags these ${match.tag}, which is your ${match.type.code} — ${match.type.name}.${rest}`;
    }
    case "NO_SUCH_TYPE":
      return (
        `The drawing tags these ${match.tag}, and you have no wall type ${match.tag} with layers on it. ` +
        `Add one on the Wall types page — this sheet's partition schedule usually says what ${match.tag} is — ` +
        `or add these as plain measurements and price them by hand.`
      );
    case "MIXED":
      return (
        `The drawing names more than one type in this group (${match.tags.join(", ")}), so it cannot be priced ` +
        `as one. Add them as plain measurements, or trace the types separately.`
      );
    case "NO_TAG":
      return null;
  }
}

/**
 * The words that tell two types apart in a picker: which faces carry board,
 * how many layers, the rating, insulation. Read off the type's own sides,
 * its parts and its notes (where a legend-made type keeps "RATING: 2 HR").
 * Nothing is guessed: a type with no board part says nothing about board.
 */
export function wallTypeSummary(type: {
  name: string;
  sides: number;
  notes?: string | null;
  components: readonly { description: string; basis: string; factor: number }[];
}): string {
  const out: string[] = [];
  const board = type.components.filter((c) => c.basis === "BOARDED_SQFT" || (c.basis === "FACE_SQFT" && /board|gyp|sheath/i.test(c.description)));
  if (board.length > 0) {
    const layers = Math.max(...board.map((c) => (Number.isFinite(c.factor) && c.factor > 0 ? Math.round(c.factor) : 1)));
    out.push(type.sides === 1 ? "board one side" : "board both sides");
    if (layers > 1) out.push(`${layers} layers`);
  }
  const text = `${type.name} ${type.notes ?? ""}`;
  const rated = /(\d(?:\.\d)?)\s*(?:-\s*)?(?:HR|HOUR)/i.exec(text);
  if (rated) out.push(`${rated[1]} HR`);
  else if (/NON-?\s*RATED/i.test(text)) out.push("non-rated");
  if (type.components.some((c) => /insul|batt/i.test(c.description))) out.push("insulated");
  if (type.components.some((c) => c.basis === "STUDS") && /\bwood\b|2x[46]/i.test(type.components.map((c) => c.description).join(" "))) out.push("wood studs");
  return out.join(" · ");
}
