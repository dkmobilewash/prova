import { describe, expect, it } from "vitest";
import { findWallsOnSheet } from "./findWallsOnSheet";
import { detectForSheet } from "./offeredCandidates";
import { wallsFromStrokes, type StrokeSegment, type WallCandidate } from "./wallVectors";

/**
 * ── A HOOK ONLY OBSERVES, AND A DRAWING IS THE SAME DRAWING IN ANY ORDER ──
 *
 * Found 2026-10-22 by holding the app against the eval on real sheets with
 * every input matched by digest: the finder returned 258 walls on Crosslines
 * A100 with an answer-key hook set and 244 without, and 35 on Baker A101 as
 * read against 27 with the strokes reversed. The first means the list a
 * reviewer labels is not the list a customer sees; the second means two
 * exports of one drawing can be bid differently.
 *
 * The drawing below is INVENTED and built to make both defects fire: stacks
 * of three parallel faces a wall apart, so which face pairs with which is a
 * greedy decision the order of the faces decides and an already-used face can
 * be awarded twice when the hook path forgets the `used` set.
 */
const FEET_PER_POINT = 1 / 10;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * An INVENTED drawing from a seed: forty double-line walls at four
 * thicknesses, horizontal and vertical, half of them with a third face a
 * wall away. Searched before it was pinned: on the finder as it stood, every
 * one of 400 seeds gave different walls with a hook set and different walls
 * reversed, so a seed here is a reproduction and not a lucky draw.
 */
function drawing(seed: number): StrokeSegment[] {
  const r = rng(seed);
  const out: StrokeSegment[] = [];
  for (let k = 0; k < 40; k += 1) {
    const horizontal = r() < 0.5;
    const t = [4, 5, 6, 8][Math.floor(r() * 4)];
    const a = Math.round(r() * 700);
    const b = Math.round(r() * 500);
    const len = 40 + Math.round(r() * 200);
    if (horizontal) {
      out.push(seg(a, b, a + len, b), seg(a, b + t, a + len, b + t));
      if (r() < 0.5) out.push(seg(a + Math.round(r() * 20), b + 2 * t, a + len - Math.round(r() * 20), b + 2 * t));
    } else {
      out.push(seg(a, b, a, b + len), seg(a + t, b, a + t, b + len));
      if (r() < 0.5) out.push(seg(a + 2 * t, b + Math.round(r() * 20), a + 2 * t, b + len - Math.round(r() * 20)));
    }
  }
  return out;
}

function seg(x1: number, y1: number, x2: number, y2: number): StrokeSegment {
  return { x1, y1, x2, y2 };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const digest = (walls: readonly WallCandidate[]) =>
  walls
    .map((w) => [w.x1, w.y1, w.x2, w.y2, w.thicknessFeet].map((v) => v.toFixed(4)).join(","))
    .sort();

const options = { feetPerPoint: FEET_PER_POINT };

const SEEDS = [1, 7, 20261022];

describe("the finder's answer does not depend on who is watching", () => {
  for (const seed of SEEDS) {
    const strokes = drawing(seed);
    const plain = digest(wallsFromStrokes(strokes, options));

    it(`seed ${seed}: finds walls on the invented drawing at all`, () => {
      expect(plain.length).toBeGreaterThan(10);
    });

    it(`seed ${seed}: an onCandidate hook changes nothing`, () => {
      let seen = 0;
      const withHook = wallsFromStrokes(strokes, { ...options, onCandidate: () => { seen += 1; } });
      expect(seen, "the hook was not called, so this proves nothing").toBeGreaterThan(0);
      expect(digest(withHook)).toEqual(plain);
    });

    it(`seed ${seed}: a veto that refuses nothing changes nothing`, () => {
      expect(digest(wallsFromStrokes(strokes, { ...options, veto: () => false }))).toEqual(plain);
    });
  }
});

describe("the finder's answer does not depend on the order the strokes are stored in", () => {
  for (const seed of SEEDS) {
    const strokes = drawing(seed);
    const plain = digest(wallsFromStrokes(strokes, options));

    it(`seed ${seed}: reversed`, () => {
      expect(digest(wallsFromStrokes([...strokes].reverse(), options))).toEqual(plain);
    });

    it(`seed ${seed}: shuffled, three ways`, () => {
      for (const shuffle of [1, 2, 3]) {
        expect(digest(wallsFromStrokes(shuffled(strokes, shuffle * 7919), options)), `shuffle ${shuffle}`).toEqual(plain);
      }
    });
  }
});

/**
 * ── THE WHOLE FINDER, WITH ARCS IN THE DRAWING ──
 *
 * `wallsFromStrokes` is the pairer. The sheet finder runs the curved-wall
 * assembler before it, and that used to read the strokes' sequence: an arc
 * was a run of pieces in file order. So the invented sheet carries two
 * concentric flattened arcs a wall apart and the rooms from above, and the
 * assertion is on `findWallsOnSheet`, shuffled.
 *
 * NO COLUMN BUBBLES, DELIBERATELY. The grid-bubble walker is still first-wins
 * in file order, and `gridBubbles.ts` says why it was left so after a
 * geometric walker was built and measured: the stage's acceptance and reach
 * are the defect, and an honest order costs 2,300 ft of key until they are
 * fixed. A bubble in this drawing would make this test red for that reason,
 * which is a true statement about the finder and not a regression to catch
 * here; the arms eval carries the number.
 */
function sheet(seed: number): StrokeSegment[] {
  const out = drawing(seed).map((s) => ({ ...s }));
  // Two concentric arcs a 6in wall apart, each flattened into pieces under a foot.
  for (const radius of [120, 125]) {
    const pieces = 40;
    for (let k = 0; k < pieces; k += 1) {
      const a1 = Math.PI + (k / pieces) * Math.PI;
      const a2 = Math.PI + ((k + 1) / pieces) * Math.PI;
      out.push(seg(400 + radius * Math.cos(a1), 300 + radius * Math.sin(a1), 400 + radius * Math.cos(a2), 300 + radius * Math.sin(a2)));
    }
  }
  return out;
}

const PAGE = { widthPt: 1000, heightPt: 700 };
const run = (segments: readonly StrokeSegment[]) =>
  findWallsOnSheet({
    segments: [...segments],
    textItems: [],
    pageSize: PAGE,
    // 10 ft per point on a 1000pt sheet: 10,000 ft per page width.
    feetPerUnit: FEET_PER_POINT * PAGE.widthPt,
    wallTypes: [],
    sampledSheets: null,
  });
const stages = (found: ReturnType<typeof run>) =>
  `${found.gridDropped}/${found.hatchDropped}/${found.duplicateDropped}/${found.walls.length}`;

describe("the whole sheet finder does not depend on the order the strokes are stored in", () => {
  for (const seed of SEEDS) {
    const strokes = sheet(seed);
    const plain = run(strokes);

    it(`seed ${seed}: the drawing exercises the arc stage`, () => {
      expect(plain.walls.some((w) => w.curved === true), "no curved wall was found, so the arc assembler was never exercised").toBe(true);
    });

    it(`seed ${seed}: reversed, same walls and same stage counts`, () => {
      const reversed = run([...strokes].reverse());
      expect(stages(reversed)).toBe(stages(plain));
      expect(digest(reversed.walls)).toEqual(digest(plain.walls));
    });

    it(`seed ${seed}: shuffled three ways, same walls and same stage counts`, () => {
      for (const shuffle of [1, 2, 3]) {
        const mixed = run(shuffled(strokes, shuffle * 7919));
        expect(stages(mixed), `shuffle ${shuffle}`).toBe(stages(plain));
        expect(digest(mixed.walls), `shuffle ${shuffle}`).toEqual(digest(plain.walls));
      }
    });
  }
});

describe("the product path gives the same answer twice", () => {
  // Baker A100 gave 87 candidates in one tab and 104 in the next (2026-10-29).
  // The finder itself was not the cause — the viewer had lost the set's
  // template on the first run — but nothing here said so. This pins the half
  // the finder owns: the same sheet, the same inputs, the same answer, run
  // after run, with and without an (empty) sample.
  const detect = (segments: readonly StrokeSegment[], sampledSheets: StrokeSegment[][] | null) =>
    detectForSheet({ segments: [...segments], textItems: [], pageSize: PAGE, feetPerUnit: FEET_PER_POINT * PAGE.widthPt, sampledSheets });
  for (const seed of SEEDS) {
    it(`seed ${seed}: detectForSheet twice is identical`, () => {
      const strokes = drawing(seed);
      const first = detect(strokes, null);
      const second = detect(strokes, null);
      expect(digest(second.found.walls)).toEqual(digest(first.found.walls));
      expect(second.planBoxes).toEqual(first.planBoxes);
      expect(second.views).toBe(first.views);
    });
  }
});
