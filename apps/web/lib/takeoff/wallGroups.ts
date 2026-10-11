import { CLUSTER_INCHES, type WallCandidate, type WallCluster } from "./wallVectors";
import { sameDesignation, type PostableWallType } from "./wallTypeMatch";

/**
 * ── A THICKNESS GROUP IS NOT ONE WALL TYPE, AND ON A REAL SHEET IT RARELY IS ──
 *
 * The panel has grouped detected walls by thickness since the finder shipped,
 * and it reports the drawing's own tags beside each group. On School-01 the
 * biggest group read:
 *
 *     4-7/8"  ·  A1 / A2 / EXT-1 / C1  ·  41 runs · 1,117 ft
 *     "names more than one type in this group, so it cannot be priced as one"
 *
 * That is 58% of the sheet's footage stopping at plain measurements — the
 * single largest thing between "upload your plans" and "here is a priced bid".
 * And the refusal was right: pricing that group as A1 prices the A2, EXT-1 and
 * C1 runs inside it wrongly.
 *
 * The group is wrong, not the refusal. So this splits it.
 *
 * ── TAG FIRST, THEN THICKNESS, THEN ASK ──
 *
 * Two sources of truth, and they are not equal:
 *
 *   1. A TAG IS AN IDENTITY. The drafter printed `A1` beside that wall. Runs
 *      carrying a clear tag become their own group and are matched by name,
 *      which is what `wallTypeMatch.ts` already does and trusts enough to price
 *      from.
 *   2. A THICKNESS IS A SHORTLIST. It narrows the candidates and, where exactly
 *      one of the company's types is that thick, it identifies one. Where two
 *      are — A1 and A2 are BOTH 4-7/8" on this very sheet, differing by fire
 *      rating, which a floor plan cannot show — it identifies nothing and the
 *      person is asked.
 *
 * That ordering is the whole safety argument. Thickness never overrules a tag,
 * and it never guesses between two types; it only speaks where the drawing was
 * silent and the answer is unique.
 *
 * ── WHY THE REMAINDER IS MOST OF THE SHEET ──
 *
 * An architect tags REPRESENTATIVE walls, not every wall. Measured on two pages
 * of a real set, 25-43% of footage carries a tag at all. So splitting by tag
 * alone would leave the majority of every sheet unpriced — which is why the
 * partition schedule (#731) had to land first. It is what gives the untagged
 * remainder a thickness to be looked up by.
 *
 * Pure. No database, no React.
 */

/** Where a group's identity came from. The estimator is told which, because
 *  the two carry different weight and a reader should not have to guess. */
export type GroupSource =
  /** The drawing printed this name beside these runs. */
  | { kind: "TAG"; tag: string }
  /** Nothing named them; they are what is left of a thickness group. */
  | { kind: "REMAINDER" };

export type WallGroup = {
  /** The thickness bucket these came from, unchanged — still what is drawn on
   *  the sheet and still what the colour key shows. */
  inches: number;
  runs: WallCandidate[];
  feet: number;
  source: GroupSource;
  /** The company's types this group could be. One is an answer; several is a
   *  question; none is a plain measurement. */
  candidates: PostableWallType[];
};

/**
 * How far a company's stated thickness may sit from a measured one.
 *
 * HALF THE CLUSTER WIDTH, derived rather than chosen — a group IS a bucket
 * `CLUSTER_INCHES` wide, so a type belongs to it exactly when its thickness
 * falls inside it. Two consequences worth stating: a type cannot belong to two
 * adjacent buckets, and if clustering is ever retuned this follows it instead
 * of silently disagreeing.
 *
 * It also clears the measurement noise it has to. `A1` measured 4.75, 4.75,
 * 4.75 and 5.00 inches across four pages of one set against a schedule value of
 * 4.875 — the worst of those is 0.125 out, half of this.
 */
export const THICKNESS_SLACK_IN = CLUSTER_INCHES / 2;

/** The company's postable types that could be a wall of this thickness. */
export function typesAtThickness(
  inches: number,
  wallTypes: readonly PostableWallType[],
): PostableWallType[] {
  return wallTypes.filter(
    (type) =>
      type.thicknessIn !== null && Math.abs(type.thicknessIn - inches) <= THICKNESS_SLACK_IN,
  );
}

/**
 * Split each thickness cluster by the drawing's own tags, and give every piece
 * the types it could be.
 *
 * A cluster becomes one group per tag found in it, plus one for whatever
 * carries no tag. Order is deliberate: tagged groups first, largest first, with
 * the remainder last — the named ones are the answers and the remainder is the
 * question, and a question reads better after the answers it depends on.
 *
 * A cluster nobody tagged comes back as a single REMAINDER group, which is the
 * common case and is why this cannot simply refuse an untagged run.
 */
export function wallGroups(
  clusters: readonly WallCluster[],
  tagByRun: ReadonlyMap<WallCandidate, string>,
  wallTypes: readonly PostableWallType[],
): WallGroup[] {
  const out: WallGroup[] = [];
  for (const cluster of clusters) {
    const byTag = new Map<string, WallCandidate[]>();
    const untagged: WallCandidate[] = [];
    for (const run of cluster.runs) {
      const tag = tagByRun.get(run);
      if (tag === undefined) {
        untagged.push(run);
        continue;
      }
      const group = byTag.get(tag);
      if (group) group.push(run);
      else byTag.set(tag, [run]);
    }

    const tagged = [...byTag.entries()]
      .map(([tag, runs]) => ({
        inches: cluster.inches,
        runs,
        feet: feetOf(runs),
        source: { kind: "TAG", tag } as const,
        // A TAG IS AN IDENTITY, so the candidate list is whatever carries that
        // code — never narrowed by thickness as well. If the drawing says A1
        // and the company's A1 is recorded at a different thickness, that is
        // worth a person's attention and is not something to silently drop:
        // the thickness on file may be the thing that is wrong.
        candidates: wallTypes.filter((type) => sameDesignation(type.code, tag)),
      }))
      .sort((a, b) => b.feet - a.feet || a.source.tag.localeCompare(b.source.tag));

    out.push(...tagged);
    if (untagged.length > 0) {
      out.push({
        inches: cluster.inches,
        runs: untagged,
        feet: feetOf(untagged),
        source: { kind: "REMAINDER" },
        candidates: typesAtThickness(cluster.inches, wallTypes),
      });
    }
  }
  return out;
}

function feetOf(runs: readonly WallCandidate[]): number {
  return runs.reduce((sum, run) => sum + run.lengthFeet, 0);
}

/** What a group is, once its candidates are counted. */
export type GroupVerdict =
  /** One type, and the drawing named it. Price it. */
  | { state: "NAMED"; type: PostableWallType; tag: string }
  /** One type, from the thickness alone, because nothing named these. */
  | { state: "ONLY_ONE_THAT_THICK"; type: PostableWallType }
  /** Several types are this thick. Only a person can say which. */
  | { state: "ASK"; types: PostableWallType[] }
  /** The drawing names a type this company does not have. */
  | { state: "NO_SUCH_TYPE"; tag: string }
  /** Nothing named them and nothing in the library is that thick. */
  | { state: "UNKNOWN" };

export function verdictFor(group: WallGroup): GroupVerdict {
  if (group.source.kind === "TAG") {
    const [type] = group.candidates;
    // More than one type sharing a CODE cannot happen — `WallType` is unique
    // on (companyId, code) — so the first is the only one.
    return type
      ? { state: "NAMED", type, tag: group.source.tag }
      : { state: "NO_SUCH_TYPE", tag: group.source.tag };
  }
  if (group.candidates.length === 1) return { state: "ONLY_ONE_THAT_THICK", type: group.candidates[0] };
  if (group.candidates.length > 1) return { state: "ASK", types: group.candidates };
  return { state: "UNKNOWN" };
}

/**
 * The sentence beside a group.
 *
 * Every one of them says WHERE the answer came from, because a name read off
 * the drawing and a name inferred from a thickness are different kinds of claim
 * and an estimator pricing a bid is entitled to know which they are looking at.
 */
export function groupSentence(group: WallGroup, verdict: GroupVerdict): string | null {
  switch (verdict.state) {
    case "NAMED":
      return `The drawing tags these ${verdict.tag}, which is your ${verdict.type.code} — ${verdict.type.name}.`;
    case "ONLY_ONE_THAT_THICK":
      return (
        `Nothing on the drawing names these. ${verdict.type.code} is the only wall type you have at ` +
        `${inches(group.inches)}, so that is what they would be priced as — check one against the drawing first.`
      );
    case "ASK":
      return (
        `Nothing on the drawing names these, and you have ${verdict.types.length} wall types at ` +
        `${inches(group.inches)} (${verdict.types.map((type) => type.code).join(", ")}). ` +
        `They differ in ways a floor plan cannot show, so pick one.`
      );
    case "NO_SUCH_TYPE":
      return (
        `The drawing tags these ${verdict.tag}, and you have no wall type ${verdict.tag} with layers on it. ` +
        `This sheet's partition schedule usually says what ${verdict.tag} is — read it on the Takeoff tab and ` +
        `add these types, or add these as plain measurements.`
      );
    case "UNKNOWN":
      return (
        `Nothing on the drawing names these and no wall type you have is ${inches(group.inches)} thick. ` +
        `They can be added as plain measurements and priced by hand.`
      );
  }
}

/** Inches to the nearest sixteenth, as a drawing writes them. Local rather than
 *  imported from the finder, because that one labels a GROUP and this one is
 *  mid-sentence — `4-7/8"` reads correctly in prose and `4⅞″ wall` does not. */
function inches(value: number): string {
  const whole = Math.floor(value);
  const sixteenths = Math.round((value - whole) * 16);
  if (sixteenths === 0) return `${whole}"`;
  if (sixteenths === 16) return `${whole + 1}"`;
  const divide = (n: number, d: number): string => (n % 2 === 0 ? divide(n / 2, d / 2) : `${n}/${d}`);
  return `${whole}-${divide(sixteenths, 16)}"`;
}
