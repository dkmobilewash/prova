import { describe, expect, it } from "vitest";
import {
  wallGroups,
  verdictFor,
  groupSentence,
  typesAtThickness,
  THICKNESS_SLACK_IN,
  type WallGroup,
} from "./wallGroups";
import type { PostableWallType } from "./wallTypeMatch";
import { CLUSTER_INCHES, type WallCandidate, type WallCluster } from "./wallVectors";

/**
 * The case this module exists for is the LAST line of these tests, and the rest
 * build up to it: School-01's 4-7/8" group, which held A1, A2, EXT-1 and C1 and
 * 1,117 ft that could not be priced as anything.
 */

let next = 0;
const run = (feet: number): WallCandidate => ({
  x1: next,
  y1: 0,
  x2: next++,
  y2: 0,
  thicknessFeet: 4.875 / 12,
  lengthFeet: feet,
});

const cluster = (inches: number, runs: WallCandidate[]): WallCluster => ({
  inches,
  runs,
  feet: runs.reduce((sum, one) => sum + one.lengthFeet, 0),
});

const type = (code: string, thicknessIn: number | null, name = `${code} partition`): PostableWallType => ({
  id: `wt_${code}`,
  code,
  name,
  thicknessIn,
});

describe("a tag splits a thickness group, and a tag is an identity", () => {
  it("SPLITS ONE THICKNESS GROUP INTO ONE GROUP PER TAG", () => {
    const a = run(40);
    const b = run(30);
    const c = run(10);
    const groups = wallGroups(
      [cluster(4.875, [a, b, c])],
      new Map([
        [a, "A1"],
        [b, "A2"],
        [c, "A1"],
      ]),
      [type("A1", 4.875), type("A2", 4.875)],
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => (group.source.kind === "TAG" ? group.source.tag : "?"))).toEqual(["A1", "A2"]);
    // A1 holds both of its runs, so the footage follows the tag and not the
    // order the runs happened to be in.
    expect(groups[0].feet).toBeCloseTo(50, 3);
    expect(groups[1].feet).toBeCloseTo(30, 3);
  });

  it("matches a tagged group BY NAME, never by thickness", () => {
    // The drawing printed the name. That outranks any measurement, which is why
    // a tagged group's candidates are not narrowed by thickness at all.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "A1"]]), [type("A1", 9)]);
    const verdict = verdictFor(group);
    expect(verdict.state).toBe("NAMED");
    if (verdict.state === "NAMED") expect(verdict.type.code).toBe("A1");
  });

  it("refuses a tag naming a type the company does not have", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "EXT-1"]]), [type("A1", 4.875)]);
    expect(verdictFor(group).state).toBe("NO_SUCH_TYPE");
  });

  it("puts the largest tagged group first and the remainder last", () => {
    // The named groups are answers and the remainder is a question. A question
    // reads better after the answers it depends on.
    const small = run(10);
    const big = run(90);
    const bare = run(50);
    const groups = wallGroups(
      [cluster(4.875, [small, big, bare])],
      new Map([
        [small, "A2"],
        [big, "A1"],
      ]),
      [type("A1", 4.875), type("A2", 4.875)],
    );
    expect(groups.map((group) => (group.source.kind === "TAG" ? group.source.tag : "remainder"))).toEqual([
      "A1",
      "A2",
      "remainder",
    ]);
  });
});

describe("the untagged remainder, which is most of every sheet", () => {
  it("IS IDENTIFIED where exactly one type is that thick", () => {
    // The whole point of reading the partition schedule. An architect tags
    // representative walls, not every wall — 25-43% of footage on a real sheet
    // — so without this the majority of every drawing stays unpriced.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [type("A1", 4.875), type("B1", 7.25)]);
    const verdict = verdictFor(group);
    expect(verdict.state).toBe("ONLY_ONE_THAT_THICK");
    if (verdict.state === "ONLY_ONE_THAT_THICK") expect(verdict.type.code).toBe("A1");
  });

  it("ASKS where two types share the thickness, and never picks one", () => {
    // ── THE CASE THAT STOPS THIS BEING A GUESSING MACHINE ──
    //
    // A1 and A2 are both 4-7/8" on School-01 and differ by fire rating, which
    // a floor plan cannot show. There is no evidence here that favours either,
    // so proposing one would be a coin flip printed as an answer — and the
    // footage would look right.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [type("A1", 4.875), type("A2", 4.875)]);
    const verdict = verdictFor(group);
    expect(verdict.state, "a shared thickness was resolved by guessing").toBe("ASK");
    if (verdict.state === "ASK") expect(verdict.types.map((one) => one.code)).toEqual(["A1", "A2"]);
  });

  it("says UNKNOWN where nothing in the library is that thick", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(12, [a])], new Map(), [type("A1", 4.875)]);
    expect(verdictFor(group).state).toBe("UNKNOWN");
  });

  it("IGNORES a type with no thickness recorded", () => {
    // A library typed in before #731 has nulls. Null means "cannot be matched
    // by thickness" — never "matches anything" — so an old library keeps the
    // behaviour it had rather than acquiring a wrong answer.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [type("A1", null)]);
    expect(verdictFor(group).state, "a type with no thickness was matched anyway").toBe("UNKNOWN");
  });

  it("keeps a cluster nobody tagged as one remainder group", () => {
    const a = run(40);
    const b = run(20);
    const groups = wallGroups([cluster(4.875, [a, b])], new Map(), [type("A1", 4.875)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].source.kind).toBe("REMAINDER");
    expect(groups[0].feet).toBeCloseTo(60, 3);
  });
});

describe("how close a stated thickness has to be to a measured one", () => {
  const types = [type("A1", 4.875)];

  it("admits the measurement noise a real sheet carries", () => {
    // A1 measured 4.75, 4.75, 4.75 and 5.00 inches across four pages of one
    // set against a schedule value of 4.875. All four have to land.
    for (const measured of [4.75, 4.875, 5.0]) {
      expect(typesAtThickness(measured, types).map((one) => one.code), `${measured}in`).toEqual(["A1"]);
    }
  });

  it("refuses a different wall", () => {
    // 6-1/8" is a 6" stud with board — a different assembly at a different
    // price, and nowhere near 4-7/8".
    expect(typesAtThickness(6.125, types)).toEqual([]);
  });

  it("is half the cluster width, so a type cannot belong to two buckets", () => {
    // Derived rather than chosen: a group IS a bucket `CLUSTER_INCHES` wide.
    expect(THICKNESS_SLACK_IN).toBeCloseTo(CLUSTER_INCHES / 2, 6);
  });

  it("KEEPS TWO TYPES HALF AN INCH APART APART", () => {
    // ── THE FIRST VERSION OF THIS CASE COULD NOT FAIL ──
    //
    // It read `typesAtThickness(4.875 + THICKNESS_SLACK_IN + 0.01, …)`, which
    // moves WITH the constant it is testing: widen the slack and the probe
    // widens with it, so the test stayed green while the behaviour doubled.
    // Found by mutation. The bound is a LITERAL here for that reason.
    //
    // And the consequence is the point rather than the number. A company whose
    // library holds a 4-7/8" and a 5-3/8" type — one layer of board each side
    // against two one side, which is an ordinary pair — would see a measured
    // 4-7/8" group match BOTH at the wider slack. An answer would become a
    // question, and on a sheet where the drawing tagged nothing it would stay
    // one.
    const pair = [type("A1", 4.875), type("B1", 5.375)];
    expect(typesAtThickness(4.875, pair).map((one) => one.code)).toEqual(["A1"]);
    expect(typesAtThickness(5.375, pair).map((one) => one.code)).toEqual(["B1"]);
  });
});

describe("every sentence says WHERE the answer came from", () => {
  const sentence = (group: WallGroup) => groupSentence(group, verdictFor(group)) ?? "";

  it("a named group cites the drawing", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "A1"]]), [type("A1", 4.875, "3-5/8 stud")]);
    expect(sentence(group)).toContain("The drawing tags these A1");
  });

  it("a thickness match says the drawing named NOTHING", () => {
    // The difference matters to somebody pricing a bid: a name read off the
    // drawing and a name inferred from a measurement are different claims, and
    // a reader must not have to guess which they are looking at.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [type("A1", 4.875)]);
    const text = sentence(group);
    expect(text).toContain("Nothing on the drawing names these");
    expect(text).toContain("only wall type you have at 4-7/8\"");
    expect(text, "a thickness guess was presented without a prompt to check it").toContain("check one");
  });

  it("an ASK names the candidates and says why it cannot choose", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [type("A1", 4.875), type("A2", 4.875)]);
    const text = sentence(group);
    expect(text).toContain("A1, A2");
    expect(text).toContain("a floor plan cannot show");
  });

  it("writes inches the way a drawing does", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(7.25, [a])], new Map(), [type("B1", 7.25)]);
    expect(sentence(group)).toContain('7-1/4"');
  });

  it("writes a whole number with no fraction", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(6, [a])], new Map(), [type("B1", 6)]);
    expect(sentence(group)).toContain('6"');
    expect(sentence(group)).not.toContain("6-0");
  });
});

describe("School-01's 4-7/8in group, which is why this module exists", () => {
  it("turns one unpriceable group into three answers and one question", () => {
    // ── THE REPORT THIS REPLACES ──
    //
    //   4-7/8"  ·  A1 / A2 / EXT-1 / C1  ·  41 runs · 1,117 ft
    //   "names more than one type in this group, so it cannot be priced as one"
    //
    // 58% of the sheet's footage, stopping at plain measurements. The refusal
    // was correct — pricing that as A1 prices the A2, EXT-1 and C1 runs wrongly
    // — and the GROUP was what needed fixing.
    const a1 = run(300);
    const a2 = run(120);
    const ext = run(90);
    const rest = run(607);
    const groups = wallGroups(
      [cluster(4.875, [a1, a2, ext, rest])],
      new Map([
        [a1, "A1"],
        [a2, "A2"],
        [ext, "EXT-1"],
      ]),
      [type("A1", 4.875), type("A2", 4.875), type("B1", 7.25)],
    );

    const verdicts = groups.map((group) => verdictFor(group));
    expect(verdicts.map((one) => one.state)).toEqual([
      "NAMED", // A1, 300 ft — the drawing said so
      "NAMED", // A2, 120 ft — likewise
      "NO_SUCH_TYPE", // EXT-1, 90 ft — named, and the library has no EXT-1
      "ASK", // 607 ft untagged, and A1 and A2 are both this thick
    ]);

    // 420 ft is priced where 0 ft was, the 90 ft names what is missing, and the
    // 607 ft asks ONE question instead of being abandoned or guessed at.
    const priced = groups
      .filter((_, index) => verdicts[index].state === "NAMED")
      .reduce((sum, group) => sum + group.feet, 0);
    expect(priced).toBeCloseTo(420, 3);
    expect(groups[3].feet).toBeCloseTo(607, 3);

    // AND THE FOOTAGE IS CONSERVED. A split that loses a run loses it from the
    // bid, which is the one failure here that nobody would see on screen.
    expect(groups.reduce((sum, group) => sum + group.feet, 0)).toBeCloseTo(1117, 3);
    expect(groups.reduce((sum, group) => sum + group.runs.length, 0)).toBe(4);
  });
});
