import { describe, expect, it } from "vitest";
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
