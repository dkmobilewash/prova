import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  wallGroups,
  settledType,
  verdictFor,
  groupSentence,
  typesAtThickness,
  THICKNESS_SLACK_IN,
  type WallGroup,
} from "./wallGroups";
import type { MatchableWallType } from "./wallTypeMatch";
import { CLUSTER_INCHES, inchLabel, type WallCandidate, type WallCluster } from "./wallVectors";

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

/** `hasParts` defaults TRUE so every case written before naming and pricing
 *  were separated keeps the meaning it had — those types all had layers. The
 *  cases that care pass it explicitly. */
const type = (
  code: string,
  thicknessIn: number | null,
  name = `${code} partition`,
  hasParts = true,
): MatchableWallType => ({
  id: `wt_${code}`,
  code,
  name,
  hasParts,
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
    // a tagged group's candidates are not narrowed by thickness at all — a
    // thickness that disagrees does NOT send the group looking for some other
    // type, it stays A1 and the disagreement is reported.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "A1"]]), [type("A1", 9)]);
    const verdict = verdictFor(group);
    expect(verdict.state).toBe("TAG_DISAGREES");
    if (verdict.state === "TAG_DISAGREES") expect(verdict.type.code).toBe("A1");
  });

  it("refuses a tag naming a type the company does not have", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "EXT-1"]]), [type("A1", 4.875)]);
    expect(verdictFor(group).state).toBe("NO_SUCH_TYPE");
  });

  it("ORDERS BY FOOTAGE, across the whole sheet", () => {
    // ── THIS CASE USED TO ASSERT THE OPPOSITE, AND A REAL SHEET SETTLED IT ──
    //
    // It read "puts the largest tagged group first and the remainder last", on
    // the reasoning that the named groups are answers and the remainder is a
    // question. Good reasoning, wrong list: splitting multiplies the rows —
    // School-01 went from eight groups to seventeen — the panel shows a fixed
    // number, and ordering per cluster put 488 ft of the drawing below the fold
    // with LARGER groups hidden under smaller ones.
    //
    // The list is a work queue, not a summary, so it is ordered by what matters
    // most. A 50 ft remainder outranks a 10 ft named group.
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
      "remainder",
      "A2",
    ]);
  });

  it("gives a TIE to the named group", () => {
    // Same footage, and a name is a better answer than a thickness — so when
    // size cannot separate them, the one the drawing named goes first.
    const named = run(40);
    const bare = run(40);
    const groups = wallGroups(
      [cluster(4.875, [named, bare])],
      new Map([[named, "A1"]]),
      [type("A1", 4.875)],
    );
    expect(groups[0].source.kind).toBe("TAG");
  });
});

describe("when the drawing's name and the measurement disagree", () => {
  // ── FOUND ON A REAL SHEET, AND ONLY VISIBLE SINCE #731 ──
  //
  // School-01 reported `B1` at three thicknesses at once and `EXT-1` at two.
  // One assembly is not three thicknesses. Either the tag is on the wrong run —
  // `tagByRun` assigns by proximity, and the nearest run to a label is not
  // always the wall it names — or the library's thickness is wrong.
  //
  // Both are a person's call, and the app has no evidence for either, so it
  // states the contradiction instead of resolving it. Before `WallType` carried
  // a thickness this could not even be noticed.

  const tagged = (inches: number, type: MatchableWallType) => {
    const a = run(40);
    const [group] = wallGroups([cluster(inches, [a])], new Map([[a, type.code]]), [type]);
    return group;
  };

  it("PRICES a tagged group as its tag even where the thickness disagrees, and keeps saying so", () => {
    // 3-3/8" of wall tagged B1, where B1 is on file at 7-3/8". The drawing
    // printed the name; the thickness on file is studs plus board and the
    // drawn wall often is not. The tag wins, the disagreement is reported.
    const verdict = verdictFor(tagged(3.375, type("B1", 7.375)));
    expect(verdict.state).toBe("TAG_DISAGREES");
    expect(settledType(verdict)?.code).toBe("B1");
    // An untagged group is still matched by thickness only.
    const a = run(40);
    const [untagged] = wallGroups([cluster(3.375, [a])], new Map(), [type("B1", 7.375)]);
    expect(verdictFor(untagged).state).toBe("UNKNOWN");
    expect(settledType(verdictFor(untagged))).toBeNull();
  });

  it("names BOTH numbers, says the tag wins, and still names the other possibility", () => {
    const group = tagged(3.375, type("B1", 7.375));
    const text = groupSentence(group, verdictFor(group)) ?? "";
    expect(text).toContain('3-3/8"');
    expect(text).toContain("the tag wins");
    expect(text).toContain('7-3/8"');
    expect(text).toContain("price as B1");
    expect(text).toContain("the tag may belong to the wall beside these");
  });

  it("still prices a tagged group that AGREES", () => {
    // The control. Without it a check that refused everything would pass.
    expect(verdictFor(tagged(7.375, type("B1", 7.375))).state).toBe("NAMED");
  });

  it("allows the measurement noise a real sheet carries", () => {
    // Same bound as the thickness match, for the same reason: a wall measured
    // at 4.75 or 5.00 against a schedule value of 4.875 is the same wall, and
    // flagging it would make this a notice nobody reads.
    expect(verdictFor(tagged(4.75, type("A1", 4.875))).state).toBe("NAMED");
    expect(verdictFor(tagged(5.0, type("A1", 4.875))).state).toBe("NAMED");
  });

  it("EXEMPTS a type with no thickness recorded", () => {
    // Null means "cannot be matched by thickness", never "disagrees with
    // everything". A library typed in before #731 is all nulls, and reading
    // those as contradictions would refuse to price anything it tagged.
    expect(
      verdictFor(tagged(3.375, type("B1", null))).state,
      "a library with no thicknesses stopped pricing tagged walls",
    ).toBe("NAMED");
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
    expect(text).toContain("only wall type you have near that");
    // The group and the type agree here, so the type's own number is NOT
    // repeated — see the cases below for why that is the condition.
    expect(text).toContain("They measure 4-7/8\"");
    expect(text).not.toContain("A1 at");
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

  it("USES THE SAME RENDERER AS THE ROW ABOVE IT", () => {
    // ── TWO RENDERERS OF ONE NUMBER, AND BOTH ON SCREEN AT ONCE ──
    //
    // This file had its own inches-to-fraction helper, rounding to the nearest
    // SIXTEENTH, while the row heading uses `inchLabel`, which rounds to the
    // nearest EIGHTH. A click-through caught the result: a row headed 7-3/8"
    // whose sentence read "no wall type you have is 7-7/16" thick". One wall,
    // two numbers, one above the other.
    //
    // The local helper is gone. This is the second list CLAUDE.md warns about,
    // in miniature, and the fix is the same one: there is one renderer.
    const odd = 7.4375; // lands between eighths, which is where they disagreed
    const a = run(40);
    const [group] = wallGroups([cluster(odd, [a])], new Map(), []);
    expect(sentence(group), "the sentence renders a thickness the row does not").toContain(
      inchLabel(odd),
    );
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
    // Largest first, which on this sheet puts the QUESTION at the top — 607 ft
    // of untagged wall is the biggest single thing on it, and burying that
    // under three smaller answers is what hid 488 ft on the real drawing.
    expect(verdicts.map((one) => one.state)).toEqual([
      "ASK", // 607 ft untagged, and A1 and A2 are both this thick
      "NAMED", // A1, 300 ft — the drawing said so
      "NAMED", // A2, 120 ft — likewise
      "NO_SUCH_TYPE", // EXT-1, 90 ft — named, and the library has no EXT-1
    ]);

    // 420 ft is priced where 0 ft was, the 90 ft names what is missing, and the
    // 607 ft asks ONE question instead of being abandoned or guessed at.
    const priced = groups
      .filter((_, index) => verdicts[index].state === "NAMED")
      .reduce((sum, group) => sum + group.feet, 0);
    expect(priced).toBeCloseTo(420, 3);
    expect(groups[0].feet).toBeCloseTo(607, 3);

    // AND THE FOOTAGE IS CONSERVED. A split that loses a run loses it from the
    // bid, which is the one failure here that nobody would see on screen.
    expect(groups.reduce((sum, group) => sum + group.feet, 0)).toBeCloseTo(1117, 3);
    expect(groups.reduce((sum, group) => sum + group.runs.length, 0)).toBe(4);
  });
});

describe("nothing a sheet found is out of reach", () => {
  /**
   * ── A CENSUS, AND THE DEFECT IT EXISTS FOR WAS FOUND ON A REAL SHEET ──
   *
   * The panel opened with eight rows and put the rest behind a SENTENCE — no
   * row, no colour, no button. On School-01 that sentence held **488 ft, 26% of
   * the drawing**, and because the order was per cluster rather than by size,
   * some of what it hid was larger than what it showed.
   *
   * Two things fix it and this file asserts the first directly (above: the
   * ordering) and the second here. A render test cannot be written for a panel
   * that needs pdf.js, a real document and a canvas, so this reads the source —
   * a census proves the code is THERE and never that a framework honours it,
   * and that limit is mild for a `useState` toggle in a component this repo's
   * own tests already render.
   */
  const viewer = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");

  it("OFFERS THE GROUPS BELOW THE FOLD, as a control rather than a sentence", () => {
    expect(viewer, "the hidden groups are not reachable").toContain("Show the other");
    expect(viewer).toContain("onClick={() => setShowingAll(true)}");
  });

  it("shows ALL of them once asked, not another page of them", () => {
    expect(viewer).toContain("showingAll ? (found ?? []) : (found ?? []).slice(0, SHOWN_AT_FIRST)");
  });

  it("names the footage behind the control, so pressing it is not a leap", () => {
    expect(viewer).toContain("found.slice(SHOWN_AT_FIRST).reduce((f, c) => f + c.feet, 0)");
  });

  it("STOPS PROMISING EACH GROUP ITS OWN COLOUR", () => {
    // ── READ AS A SENTENCE, BECAUSE THE FIRST VERSION OF THIS CASE WAS NOT ──
    //
    // It asserted two fragments — that "Each group is drawn on the" was gone
    // and "Hover a row to pick its" was present. Both were true of a headline
    // that read:
    //
    //   "Hover a row to pick its sheet in its own colour"
    //
    // Nonsense, and it still carried the claim the change existed to remove.
    // A find-and-replace had taken the first half of the old sentence and left
    // the second, and a test of the halves cannot see that. So this reads the
    // whole line and asserts the CLAIM is gone, not a fragment of it.
    const headline = (viewer.match(/runs of wall\.[\s\S]{0,160}?<\/p>/) ?? [""])[0]
      .replace(/\s+/g, " ");
    expect(headline, "the headline still promises a colour per group").not.toMatch(/own colour/);
    expect(headline, "nothing tells anybody how to tell two groups apart").toMatch(/Hover a row/);
    // And it still says WHY somebody should look, which is the whole posture:
    // a found wall is a proposal and the drawing is the check.
    expect(headline).toMatch(/real walls/);
  });

  it("forgets that it was expanded when the sheet is read again", () => {
    // A stale `true` across a re-run would show a fold that is not there, and
    // across a sheet change would show another sheet's.
    expect(viewer).toContain("setShowingAll(false)");
  });

  it("reads the file it thinks it is reading", () => {
    expect(viewer).toContain("Find the walls");
    expect(viewer.length).toBeGreaterThan(20000);
  });
});

/**
 * ── A TYPE CAN NAME A GROUP BEFORE IT CAN PRICE ONE ──
 *
 * Measured on School-01, 2026-10-11, and this is the case the whole change
 * exists for. The partition schedule on A-501 was read into ten wall types —
 * A1, A2, B1, C1, D1, F1, EXT-1, EXT-2, CMU, SF — each carrying the thickness
 * the drawing prints. Then **Find the walls** on A-101 found 63 runs, tagged
 * them A1 and A2 off the drawing, and said:
 *
 *   "Nothing on the drawing names these and no wall type you have is 4-7/8"
 *    thick."
 *
 * beside a row it had just tagged A1, with A1 in the library at 4-7/8".
 *
 * Neither sentence was lying. The takeoff page filtered the matcher's list to
 * `components: { some: {} }` — types with layers — so the imported types were
 * not in the list the matcher was reasoning about. The filter was right about
 * POSTING and was applied to NAMING, which is a different question, and the
 * import's own button promises the opposite: "Each one arrives with its
 * thickness, so a wall measured on the drawing can find it."
 *
 * So naming sees every type, pricing still requires parts, and the sentence
 * says which of the two is missing.
 */
describe("a wall type with no parts on it yet", () => {
  const partsless = (code: string, inches: number) => type(code, inches, `${code} partition`, false);

  it("STILL NAMES A GROUP THE DRAWING TAGS — the School-01 case", () => {
    const a = run(40);
    const [group] = wallGroups(
      [cluster(4.875, [a])],
      new Map([[a, "A1"]]),
      [partsless("A1", 4.875)],
    );
    const verdict = verdictFor(group);
    expect(verdict.state, "a tagged group went unnamed because its type has no parts").toBe("NAMED");
  });

  it("says it cannot be priced YET, and where to fix that", () => {
    const a = run(40);
    const [group] = wallGroups(
      [cluster(4.875, [a])],
      new Map([[a, "A1"]]),
      [partsless("A1", 4.875)],
    );
    const sentence = groupSentence(group, verdictFor(group)) ?? "";
    expect(sentence).toContain("A1");
    expect(sentence, "nothing says the type is unpriceable").toMatch(/no parts on it yet/);
    expect(sentence, "nothing says where to put that right").toMatch(/Wall types/);
  });

  it("leaves a type WITH parts saying none of that", () => {
    // The ordinary case must not acquire a caveat it does not have.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "A1"]]), [type("A1", 4.875)]);
    const sentence = groupSentence(group, verdictFor(group)) ?? "";
    expect(sentence).toContain("which is your A1");
    expect(sentence).not.toMatch(/no parts on it yet/);
  });

  it("is still matched by THICKNESS when the drawing names nothing", () => {
    // The untagged majority — 57% to 75% of a real sheet's footage — reaches a
    // type by thickness alone, and that path must see partless types too.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [partsless("A1", 4.875)]);
    expect(verdictFor(group).state).toBe("ONLY_ONE_THAT_THICK");
  });
});

/**
 * ── A GENERAL NOTE NAMES WHAT NOTHING TAGGED ──
 *
 * "ALL PARTITIONS TYPE A1 U.N.O." is the convention that makes an untagged wall
 * meaningful: the architect tags the exceptions and lets the note cover the
 * rest. On School-01's A-101 that is 556 ft, about 30% of the sheet, which the
 * panel was offering as A1, A2 or C1 with nothing to choose between them.
 *
 * THE SECOND CASE IS THE SAFETY AND IT IS WHY THIS IS SHIPPABLE. "ALL
 * PARTITIONS ARE A1" must not swallow the exterior shell. On that same sheet
 * the 6-5/8" perimeter and the 10-1/4" chase are untagged too, and a different
 * thickness IS a notation — the note's own "unless noted otherwise" is what
 * excuses them. Verified on the real sheet: with the note read, those groups
 * came back UNKNOWN and TAG_DISAGREES exactly as before.
 */
describe("a sheet's general note naming the default", () => {
  const A1 = type("A1", 4.875);
  const note = { type: A1, note: "1. ALL PARTITIONS TYPE A1 U.N.O." };

  it("OFFERS ITS TYPE FIRST FOR AN UNTAGGED GROUP THAT MEASURES LIKE IT — an ASK, never an answer", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [A1, type("A2", 4.875)], note);
    expect(group.source.kind).toBe("GENERAL_NOTE");
    expect(group.candidates.map((t) => t.code), "the note's type leads, the other at this thickness follows").toEqual(["A1", "A2"]);
    const verdict = verdictFor(group);
    expect(verdict.state).toBe("ASK");
    expect(verdict.state === "ASK" && verdict.suggested?.code).toBe("A1");
    expect(verdict.state === "ASK" && verdict.note).toBe(note.note);
    expect(groupSentence(group, verdict)).toMatch(/offered first/);
  });

  it("DOES NOT TOUCH A GROUP OF A DIFFERENT THICKNESS — the exterior shell", () => {
    // 6-5/8" of untagged perimeter on a sheet whose note says all partitions
    // are A1 at 4-7/8". Calling that A1 would price the building's shell as an
    // interior partition.
    const a = run(140);
    const [group] = wallGroups([cluster(6.625, [a])], new Map(), [A1], note);
    expect(group.source.kind, "the note swallowed a wall of another thickness").toBe("REMAINDER");
    const verdict = verdictFor(group);
    expect(verdict.state === "ASK" ? verdict.suggested : undefined, "no note type offered on the shell").toBeUndefined();
  });

  it("NEVER OVERRULES A TAG, because a tag is printed beside its own wall", () => {
    const a = run(40);
    const [group] = wallGroups(
      [cluster(4.875, [a])],
      new Map([[a, "A2"]]),
      [A1, type("A2", 4.875)],
      note,
    );
    expect(group.source.kind).toBe("TAG");
    const verdict = verdictFor(group);
    expect(verdict.state === "NAMED" && verdict.type.code).toBe("A2");
  });

  it("QUOTES THE NOTE, rather than saying the app concluded something", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [A1], note);
    const sentence = groupSentence(group, verdictFor(group)) ?? "";
    expect(sentence, "the note is not quoted").toContain("ALL PARTITIONS TYPE A1 U.N.O.");
    expect(sentence).toContain("A1");
    expect(sentence, "nothing says the estimator decides").toMatch(/nothing is priced until you do/);
    expect(sentence, "the note's type must read as an offer").toMatch(/offered first/);
  });

  it("behaves exactly as before when no note was found", () => {
    // The parameter is optional and every sheet without such a note keeps the
    // question it used to ask.
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [A1, type("A2", 4.875)]);
    expect(group.source.kind).toBe("REMAINDER");
    expect(verdictFor(group).state).toBe("ASK");
  });

  it("is still OFFERED when the named type has NO recorded thickness, because offering is not applying", () => {
    // Null means "cannot be matched by thickness". Applying it would be a
    // guess; offering it first in a picker the estimator must answer is not.
    const bare = type("A1", null);
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [bare], {
      type: bare,
      note: "ALL PARTITIONS TYPE A1 U.N.O.",
    });
    expect(group.source.kind).toBe("GENERAL_NOTE");
    expect(verdictFor(group).state).toBe("ASK");
  });
});

/**
 * ── THE SENTENCE USED TO SAY THE TYPE WAS THE GROUP'S THICKNESS ──
 *
 * Caught by somebody reading the panel against the partition schedule on
 * School-01's A-101, 2026-10-11 — two contradictions on one screen:
 *
 *   "B1 is the only wall type you have at 7-3/8""   — B1 is recorded at 7-1/4"
 *   "3 wall types at 4-7/8" (A1, A2, C1)"           — C1 is recorded at 4-3/4"
 *
 * A type is matched to a group within `THICKNESS_SLACK_IN`, so the two numbers
 * legitimately differ by up to a quarter inch. Neither was wrong on its own;
 * the sentence joining them was. An estimator who checks the panel against the
 * schedule finds a contradiction the app invented, which is the fastest way to
 * lose their trust in every other number on the screen.
 */
describe("a sentence naming a type whose thickness differs", () => {
  const sentence = (group: WallGroup) => groupSentence(group, verdictFor(group)) ?? "";

  it("SPELLS OUT THE TYPE'S OWN THICKNESS — the B1 case", () => {
    // 7-3/8" of wall, and the only type near it is B1 at 7-1/4".
    const a = run(40);
    const [group] = wallGroups([cluster(7.375, [a])], new Map(), [type("B1", 7.25)]);
    const text = sentence(group) ?? "";
    expect(text).toContain("They measure 7-3/8\"");
    expect(text, "the type's own thickness is still missing").toContain("B1 at 7-1/4\"");
    expect(text, "B1 is still claimed to be 7-3/8\" thick").not.toMatch(
      /B1 is the only wall type you have at 7-3\/8/,
    );
  });

  it("SPELLS IT OUT IN A LIST TOO — the A1, A2, C1 case", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [
      type("A1", 4.875),
      type("A2", 4.875),
      type("C1", 4.75),
    ]);
    const text = sentence(group) ?? "";
    expect(text).toContain("They measure 4-7/8\"");
    // The two that agree are bare; the one that differs carries its number.
    expect(text).toContain("A1, A2, C1 at 4-3/4\"");
    expect(text, "all three are still claimed to be 4-7/8\"").not.toMatch(
      /wall types at 4-7\/8" \(A1, A2, C1\)/,
    );
  });

  it("STAYS QUIET WHEN THE NUMBERS AGREE, so the sentence does not repeat itself", () => {
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map(), [
      type("A1", 4.875),
      type("A2", 4.875),
    ]);
    const text = sentence(group) ?? "";
    expect(text).toContain("A1, A2");
    expect(text, "the type's thickness is repeated when it adds nothing").not.toContain("at 4-7/8\"");
  });

  it("says nothing extra for a type with NO recorded thickness", () => {
    // Null means "cannot be matched by thickness". It reaches these sentences
    // only through a tag, but the helper must not print "A1 at null".
    const a = run(40);
    const [group] = wallGroups([cluster(4.875, [a])], new Map([[a, "A1"]]), [type("A1", null)]);
    const text = sentence(group) ?? "";
    expect(text).toContain("A1");
    expect(text).not.toContain("at null");
    expect(text).not.toContain("NaN");
  });
});
