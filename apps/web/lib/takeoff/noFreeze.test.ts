import { describe, expect, it } from "vitest";
import { detectOffThread } from "./detectOffThread";
import { detectForSheet } from "./offeredCandidates";
import { segmentGrid, segmentsOfLength } from "./segmentGrid";
import { tagSymbols } from "./tagSymbols";
import { SheetTooSlowError, spendTime, withTimeBudget } from "./timeBudget";
import { dashedFaceCount, featuresFor, penPercentileFor, runsMeeting, twinFaces } from "./wallFeatures";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── NO SHEET FREEZES THE TAB (Broadway A1.0, Chrome Round 22, 2026-11-13) ──
 *
 * Run takeoff held the tab for more than 3.5 minutes, twice. The sheet's notes and title block are
 * outlined lettering: 552,997 strokes, 45,874 wall candidates. Measured in Node, `productDetection`
 * took 357 s, of it `faceIsDashed` 123 s (every candidate scanned every stroke) and `tagSymbols`
 * 94 s (a loop walk re-walked each letter's chords in every order until its budget ran out).
 * After: about 30 s, same 118 walls, same 45,874 candidates — and it runs in a worker under a time
 * budget (`detectOffThread.ts`), so the page keeps its spinner whatever the sheet.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2 });

describe("the tag-symbol walk is linear in the strokes, not exponential in a letter's chords", () => {
  // A stroke hanging off a small fully-connected knot: the walk from it can never close (its start
  // touches nothing else), so the old walk tried every order of the knot's 15 chords until its
  // 4,000-step budget ran out — per stroke, which on Broadway was 554 million steps.
  function knots(n: number): StrokeSegment[] {
    const hanging: StrokeSegment[] = [];
    const knot: StrokeSegment[] = [];
    for (let k = 0; k < n; k += 1) {
      const ox = (k % 50) * 20;
      const oy = Math.floor(k / 50) * 20;
      const v = Array.from({ length: 6 }, (_, i) => ({ x: ox + 2 * Math.cos((i * Math.PI) / 3), y: oy + 2 * Math.sin((i * Math.PI) / 3) }));
      hanging.push(seg(ox + 6, oy, v[0].x, v[0].y));
      for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) knot.push(seg(v[i].x, v[i].y, v[j].x, v[j].y));
    }
    return [...hanging, ...knot];
  }

  it("walks each stroke a bounded number of times (was 4,000 per hanging stroke)", () => {
    const segments = knots(300);
    const walkSteps = { count: 0 };
    tagSymbols({ segments, text: [], unitsPerPaperInch: 72, walkSteps });
    expect(walkSteps.count, "the counter never moved, so this proves nothing").toBeGreaterThan(0);
    expect(walkSteps.count).toBeLessThanOrEqual(segments.length * 10);
  });

  it("still finds a tag drawn among the knots", () => {
    const segments = knots(20);
    // A diamond of radius 10 pt, the size a wall tag prints at, with its code inside.
    const c = { x: 500, y: 500 };
    const d = [
      { x: c.x + 10, y: c.y },
      { x: c.x, y: c.y + 10 },
      { x: c.x - 10, y: c.y },
      { x: c.x, y: c.y - 10 },
    ];
    for (let i = 0; i < 4; i += 1) segments.push(seg(d[i].x, d[i].y, d[(i + 1) % 4].x, d[(i + 1) % 4].y));
    const found = tagSymbols({ segments, text: [{ str: "W1", x: c.x - 4, y: c.y + 3, width: 8, height: 6 }], unitsPerPaperInch: 72 });
    expect(found.filter((s) => s.rejected === null).map((s) => [s.shape, s.text])).toEqual([["diamond", "W1"]]);
  });
});

describe("a time budget stops the finder with a sentence instead of a hang", () => {
  const PAGE = { widthPt: 1000, heightPt: 700 };
  function drawing(seed: number): StrokeSegment[] {
    const r = rng(seed);
    const out: StrokeSegment[] = [];
    for (let k = 0; k < 40; k += 1) {
      const t = [4, 5, 6, 8][Math.floor(r() * 4)];
      const a = Math.round(r() * 700);
      const b = Math.round(r() * 500);
      const len = 40 + Math.round(r() * 200);
      if (r() < 0.5) out.push(seg(a, b, a + len, b), seg(a, b + t, a + len, b + t));
      else out.push(seg(a, b, a, b + len), seg(a + t, b, a + t, b + len));
    }
    return out;
  }
  const input = (segments: StrokeSegment[], note = false) => ({
    segments,
    // A general note naming a default type, so the rebuilt `regroup` has a default to carry.
    textItems: note ? [{ str: "ALL PARTITIONS TYPE C1 U.N.O.", x: 760, y: 680, width: 200, height: 8 }] : [],
    wallTypes: note ? [{ id: "c1", code: "C1", name: "C1", hasParts: true, thicknessIn: null }] : [],
    pageSize: PAGE,
    feetPerUnit: PAGE.widthPt / 10,
    sampledSheets: null,
  });

  it("past the budget, detection throws SheetTooSlowError naming the stage", () => {
    let thrown: unknown = null;
    try {
      withTimeBudget(-1, () => detectForSheet(input(drawing(7))));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SheetTooSlowError);
    expect((thrown as SheetTooSlowError).message).toMatch(/took longer than .* seconds to read \(it was .+\), so the wall finder stopped\. Trace the walls by hand on this one\./);
  });

  it("outside a budget nothing is checked, so the evals and training rows run to the end", () => {
    expect(() => spendTime("anything")).not.toThrow();
    expect(detectForSheet(input(drawing(7))).found.walls.length).toBeGreaterThan(5);
  });

  it("budgets nest and the outer one is back when the inner ends", () => {
    withTimeBudget(60_000, () => {
      expect(() => withTimeBudget(-1, () => spendTime("inner"))).toThrow(SheetTooSlowError);
      expect(() => spendTime("outer")).not.toThrow();
    });
  });

  it("off the page's thread the answer is the finder's, regroup included", async () => {
    const segments = drawing(20261022);
    const direct = detectForSheet(input(segments, true));
    expect(JSON.stringify(direct.found.groups), "the note's default never reached a group, so this proves nothing").toContain('"C1"');
    const { detected, pairings } = await detectOffThread({ input: input(segments, true), budgetMs: 60_000 }, 120_000);
    expect(detected.found.walls).toEqual(direct.found.walls);
    expect(detected.found.groups).toEqual(direct.found.groups);
    expect(pairings.length).toBeGreaterThan(0);
    // The page rebuilds `regroup` from data; it must group a filtered list as the finder's own does.
    const some = direct.found.walls.filter((_, i) => i % 2 === 0);
    expect(detected.found.regroup(some)).toEqual(direct.found.regroup(some));
  });

  it("off the page's thread a sheet past the budget throws the same error the viewer words", async () => {
    await expect(detectOffThread({ input: input(drawing(1)), budgetMs: -1 }, 120_000)).rejects.toBeInstanceOf(SheetTooSlowError);
  });
});

describe("the wall features read through a grid and give exactly what a scan gave", () => {
  // The scans as they were before 2026-11-13, kept here as the reference.
  const lengthOf = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const fpuOf = (w: WallCandidate) => w.lengthFeet / Math.max(Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 1e-9);
  function scanRunsMeeting(wall: WallCandidate, faces: readonly StrokeSegment[], a: StrokeSegment, b: StrokeSegment): number {
    const fpu = fpuOf(wall);
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
    const l = Math.hypot(dx, dy);
    if (l === 0) return 0;
    let n = 0;
    for (const o of faces) {
      if (o === a || o === b) continue;
      const ox = o.x2 - o.x1, oy = o.y2 - o.y1;
      const ol = Math.hypot(ox, oy);
      if (ol * fpu < 2 || Math.abs((dx * ox + dy * oy) / (l * ol)) > 0.26) continue;
      for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
        const t = ((x - wall.x1) * dx + (y - wall.y1) * dy) / (l * l);
        const off = Math.abs(dx * (wall.y1 - y) - (wall.x1 - x) * dy) / l;
        if (t >= -0.02 && t <= 1.02 && off * fpu <= 1.5) { n += 1; break; }
      }
      if (n >= 20) break;
    }
    return n;
  }
  function scanDashed(wall: WallCandidate, side: 1 | -1, strokes: readonly StrokeSegment[]): boolean {
    const fpu = fpuOf(wall);
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
    const l = Math.hypot(dx, dy);
    if (l === 0) return false;
    const L = wall.lengthFeet;
    const ux = dx / l, uy = dy / l;
    const half = wall.thicknessFeet / 2;
    const reachU = (half + 0.25) / fpu;
    const minX = Math.min(wall.x1, wall.x2) - reachU, maxX = Math.max(wall.x1, wall.x2) + reachU;
    const minY = Math.min(wall.y1, wall.y2) - reachU, maxY = Math.max(wall.y1, wall.y2) + reachU;
    const pieces: [number, number][] = [];
    for (const s of strokes) {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
      const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
      const sl = Math.hypot(sdx, sdy);
      if (sl === 0 || Math.abs((sdx * ux + sdy * uy) / sl) < 0.97) continue;
      const cross = dx * (my - wall.y1) - dy * (mx - wall.x1);
      if (wall.thicknessFeet > 0.05 && Math.sign(cross) !== side) continue;
      if (Math.abs((Math.abs(cross) / l) * fpu - half) > 0.25) continue;
      const t1 = ((s.x1 - wall.x1) * ux + (s.y1 - wall.y1) * uy) * fpu;
      const t2 = ((s.x2 - wall.x1) * ux + (s.y2 - wall.y1) * uy) * fpu;
      const p = Math.max(0, Math.min(t1, t2)), q = Math.min(L, Math.max(t1, t2));
      if (q > p) pieces.push([p, q]);
    }
    pieces.sort((p, q) => p[0] - q[0]);
    let covered = 0, cur = -1, longest = 0, n = 0;
    const gaps: number[] = [];
    for (const [p0, q0] of pieces) {
      const p1 = Math.max(p0, cur);
      if (q0 <= p1) continue;
      if (cur >= 0 && p1 - cur > 0.05) gaps.push(p1 - cur);
      covered += q0 - p1;
      cur = q0;
      n += 1;
      longest = Math.max(longest, q0 - p0);
    }
    if (n < 5 || longest > 2.5 || gaps.length === 0) return false;
    const medGap = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
    const cover = covered / Math.max(L, 0.01);
    return medGap <= 2.5 && cover >= 0.25 && cover <= 0.9;
  }
  function scanTwins(wall: WallCandidate, a: StrokeSegment, faces: readonly StrokeSegment[]): number {
    const la = lengthOf(a);
    if (la === 0) return 0;
    const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
    const tol = la * 0.03;
    const own = (wall.thicknessFeet * 3) / fpuOf(wall);
    let n = 0;
    for (const o of faces) {
      if (o === a) continue;
      const lo = lengthOf(o);
      if (Math.abs(lo - la) > Math.max(tol, 1e-9)) continue;
      const ol = lo || 1;
      if (Math.abs(ux * ((o.x2 - o.x1) / ol) + uy * ((o.y2 - o.y1) / ol)) < 0.97) continue;
      if (Math.hypot((o.x1 + o.x2) / 2 - (a.x1 + a.x2) / 2, (o.y1 + o.y2) / 2 - (a.y1 + a.y2) / 2) <= own) continue;
      n += 1;
      if (n >= 50) break;
    }
    return n;
  }

  // A sheet of walls, dashed faces, partitions meeting them, repeated lengths, zero-length and
  // sheet-long strokes: everything each scan asks about.
  function sheet(seed: number) {
    const r = rng(seed);
    const faces: StrokeSegment[] = [];
    const strokes: StrokeSegment[] = [];
    const pairs: { a: StrokeSegment; b: StrokeSegment; wall: WallCandidate }[] = [];
    const dashedFaces = new Set<StrokeSegment>();
    for (let k = 0; k < 60; k += 1) {
      const x = r() * 900, y = r() * 600, len = 20 + r() * 200, t = 3 + Math.floor(r() * 6);
      const across = r() < 0.5;
      const a = across ? seg(x, y, x + len, y) : seg(x, y, x, y + len);
      const b = across ? seg(x, y + t, x + len, y + t) : seg(x + t, y, x + t, y + len);
      faces.push(a, b);
      pairs.push({ a, b, wall: { x1: across ? x : x + t / 2, y1: across ? y + t / 2 : y, x2: across ? x + len : x + t / 2, y2: across ? y + t / 2 : y + len, lengthFeet: len / 10, thicknessFeet: t / 10 } });
      // A dashed face is drawn as dashes only: its solid line is not among the strokes.
      if (r() < 0.5) {
        dashedFaces.add(a);
        for (let d = 0; d < len - 6; d += 6) strokes.push(across ? seg(x + d, y, x + d + 3, y) : seg(x, y + d, x, y + d + 3));
      }
      if (r() < 0.5) faces.push(across ? seg(x + len / 2, y - 30, x + len / 2, y) : seg(x - 30, y + len / 2, x, y + len / 2));
      if (r() < 0.3) faces.push(across ? seg(x + 300, y + 200, x + 300 + len, y + 200) : seg(x + 200, y + 300, x + 200, y + 300 + len));
    }
    faces.push(seg(10, 10, 10, 10), seg(0, 650, 1000, 650), seg(5, 0, 5, 700));
    strokes.push(...faces.filter((f) => !dashedFaces.has(f)), seg(3, 3, 3, 3));
    return { faces, strokes, pairs };
  }

  it("the grid returns every segment whose box meets the query, in the array's order", () => {
    // Shifted down the page, so the grid's two origins differ (a row read from the x origin is lost).
    const strokes = sheet(3).strokes.map((s) => ({ ...s, y1: s.y1 + 3000, y2: s.y2 + 3000 }));
    const grid = segmentGrid(strokes);
    const r = rng(11);
    for (let q = 0; q < 200; q += 1) {
      const x = r() * 1000, y = 3000 + r() * 700, w = r() * (q % 10 === 0 ? 900 : 60), h = r() * 60;
      const got = grid.near(x, y, x + w, y + h);
      const must = strokes.flatMap((s, i) => (Math.max(s.x1, s.x2) >= x && Math.min(s.x1, s.x2) <= x + w && Math.max(s.y1, s.y2) >= y && Math.min(s.y1, s.y2) <= y + h ? [i] : []));
      expect(must.every((i) => got.includes(i)), `query ${q} missed a segment`).toBe(true);
      expect([...got]).toEqual([...new Set(got)].sort((p, q2) => p - q2));
    }
  });

  it("the length window returns every segment of about that length", () => {
    const { faces } = sheet(5);
    for (const target of [faces[0], faces[7], faces[30]]) {
      const la = Math.hypot(target.x2 - target.x1, target.y2 - target.y1);
      const got = segmentsOfLength(faces, la * 0.97, la * 1.03);
      const must = faces.flatMap((s, i) => (Math.abs(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) - la) <= la * 0.03 ? [i] : []));
      expect(must.every((i) => got.includes(i))).toBe(true);
    }
  });

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: dashed faces, runs meeting, twins and the neighbourhood match the scans`, () => {
      const { faces, strokes, pairs } = sheet(seed);
      const penPercentile = penPercentileFor(faces);
      let dashed = 0, meeting = 0, twins = 0;
      for (const { a, b, wall } of pairs) {
        const d = dashedFaceCount(wall, strokes);
        expect(d).toBe((scanDashed(wall, 1, strokes) ? 1 : 0) + (scanDashed(wall, -1, strokes) ? 1 : 0));
        dashed += d;
        const m = runsMeeting(wall, faces, a, b);
        expect(m).toBe(scanRunsMeeting(wall, faces, a, b));
        meeting += m;
        const t = twinFaces(wall, a, faces);
        expect(t).toBe(scanTwins(wall, a, faces));
        twins += t;
        const row = featuresFor(a, b, wall, { penPercentile, faces, scheduledIn: [], inHatchSeries: false, sheetSpan: 1000, strokes });
        // parallelNeighbours, from the scan: parallel, within three thicknesses, overlapping a third.
        const la = Math.max(lengthOf(a), 1e-9);
        const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
        const off = (o: StrokeSegment) => -((o.x1 + o.x2) / 2 - a.x1) * uy + ((o.y1 + o.y2) / 2 - a.y1) * ux;
        const band = (Math.abs(off(b)) || 1e-9) * 3;
        const overlap = (o: StrokeSegment) => {
          const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
          return Math.max(0, Math.min(la, Math.max(at(o.x1, o.y1), at(o.x2, o.y2))) - Math.max(0, Math.min(at(o.x1, o.y1), at(o.x2, o.y2))));
        };
        const neighbours = faces.filter((o) => {
          if (o === a || o === b) return false;
          const ol = lengthOf(o) || 1;
          if (Math.abs(ux * ((o.y2 - o.y1) / ol) - uy * ((o.x2 - o.x1) / ol)) > 0.05) return false;
          if (Math.abs(off(o)) > band) return false;
          return !(overlap(o) < 0.3 * Math.min(la, lengthOf(o)));
        }).length;
        expect(row[17]).toBe(neighbours);
      }
      expect(dashed, "no dashed face on the sheet, so the dash count was not exercised").toBeGreaterThan(0);
      expect(meeting).toBeGreaterThan(0);
      expect(twins).toBeGreaterThan(0);
    });
  }
});
