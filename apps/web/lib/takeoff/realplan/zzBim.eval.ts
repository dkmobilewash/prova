import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { WallCandidate } from "../wallVectors";

/**
 * ── THE BIM HELD-OUT TEST SET ──
 *
 * Sheets rendered from real IFC building models, each with an exact answer key
 * taken from the model rather than from a drawing somebody interpreted. These
 * are TEST ONLY and never training data: a model tuned on them stops being a
 * measurement of anything.
 *
 * Two things make them different from every other fixture here, and both
 * matter for reading the numbers:
 *
 *   - the key's centreline is the MODEL's, so a wall's length is what the
 *     building says it is, including how the model joins corners. No fixture
 *     generator decided it and no estimator traced it.
 *   - walls carry a ROLE, so furring can be scored in and out. Furring is a
 *     thin finish layer on the face of something else; whether a sub bills it
 *     as wall depends on the trade and the contract, so the honest report is
 *     both numbers rather than a choice made here.
 *
 *     BIM_DIR="$HOME/Claude Folder/takeoff/bim-sheets" \
 *     BIM_OUT="$HOME/Claude Folder/takeoff/shots/bim" \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzBim.eval.ts
 */
/**
 * ── THE SPLIT, AGREED WITH DIEGO 2026-10-18 ──
 *
 * DEV      clinic, esplanades, smiley-west — fixed and measured against.
 * HELD-OUT kit-office, fzk-haus, duplex — never looked at while fixing, and
 *          scored once at the end.
 *
 * Split by BUILDING rather than by sheet, for the reason the plan-set split
 * uses: two floors of one building share an office's conventions and its
 * renderer, so scoring on one after tuning on the other is scoring on a sheet
 * the work has effectively seen. `BIM_GROUP=dev` and `BIM_GROUP=held` select
 * them; naming the group rather than remembering which folders are which is
 * what stops a held-out building being read by accident.
 */
export const BIM_DEV = ["medical-dental-clinic", "esplanades", "kit-smiley-west"];
export const BIM_HELD_OUT = ["kit-office", "kit-fzk-haus", "duplex-apartment"];

const DIR = process.env.BIM_DIR ?? "";
const GROUP = process.env.BIM_GROUP ?? "";
const OUT = process.env.BIM_OUT ?? "";
const ONLY = process.env.BIM_ONLY ?? "";

type KeyWall = {
  id: string;
  role: string;
  thickness_in: number;
  curved: boolean;
  cut_by_plan: boolean;
  length_ft: number;
  centerline_pt: [number, number][];
};

type BimKey = {
  id: string;
  renderer: string;
  source_model: string;
  storey: string;
  page_size_pt: [number, number];
  views: { pt_per_ft: number; scale_text: string }[];
  totals: {
    wall_lf_total: number;
    wall_lf_without_furring: number;
    wall_lf_by_role: Record<string, number>;
  };
  walls: KeyWall[];
  features: { id: number; type: string; subtype: string | null }[];
  pieces: { segments: number[][] };
};

type Line = { x1: number; y1: number; x2: number; y2: number };

const lengthOf = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

const parallelism = (a: Line, b: Line) => {
  const la = lengthOf(a) || 1;
  const lb = lengthOf(b) || 1;
  return Math.abs(((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb));
};

const offLine = (a: Line, px: number, py: number) => {
  const len = lengthOf(a) || 1;
  return Math.abs(-(px - a.x1) * ((a.y2 - a.y1) / len) + (py - a.y1) * ((a.x2 - a.x1) / len));
};

const overlapOf = (a: Line, b: Line) => {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
};

/** Is this run on that key wall's line at all? Position only — how MUCH of
 *  the wall it covers is measured separately, in feet. */
const onTheLine = (kw: Line & { thickness_in: number }, r: WallCandidate, feetPerUnit: number) =>
  parallelism(kw, r) > 0.98 &&
  offLine(kw, (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2) <=
    Math.max(r.thicknessFeet / feetPerUnit, kw.thickness_in / 12 / feetPerUnit, 0.002) * 2;

/**
 * ── MISSING IS FEET OF WALL, NOT A COUNT OF WALLS ──
 *
 * This used to ask whether a run covered HALF THE SHORTER of the two, which
 * on a long wall is half the RUN: a 5 ft run lying on an 85 ft facade made the
 * whole 85 ft count as found, and the other 80 ft vanished from the score.
 * Every exterior wall broken by windows is exactly that shape, so the number
 * this set exists to measure was the one it could not see — and a fix that
 * bridged 353 gaps on one sheet moved the printed score by nothing at all,
 * which is how it was noticed.
 *
 * So coverage is a UNION OF SPANS along the wall, in feet, and a wall
 * contributes its uncovered length. The same union, taken the other way,
 * gives the feet of run that lie on no wall.
 */
const unionLength = (pieces: { from: number; to: number }[]): number => {
  if (pieces.length === 0) return 0;
  const sorted = [...pieces].sort((p, q) => p.from - q.from);
  let total = 0;
  let at = sorted[0].from;
  let end = sorted[0].to;
  for (const piece of sorted.slice(1)) {
    if (piece.from > end) {
      total += end - at;
      at = piece.from;
      end = piece.to;
    } else if (piece.to > end) {
      end = piece.to;
    }
  }
  return total + (end - at);
};

/** Where `b` lies along `a`, clipped to `a`. */
const spanAlong = (a: Line, b: Line): { from: number; to: number } | null => {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return hi > lo ? { from: lo, to: hi } : null;
};

type Row = {
  id: string;
  model: string;
  storey: string;
  renderer: string;
  keyAll: number;
  keyNoFur: number;
  foundFt: number;
  missAll: number;
  extraAll: number;
  missNoFur: number;
  extraNoFur: number;
  runs: number;
  /** Feet of missed wall by what the missed wall IS. */
  missBy: Map<string, number>;
  /** Feet of extra by what the extra run SITS ON in the key's own pieces. */
  extraBy: Map<string, number>;
};

const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

describe.skipIf(DIR === "")("the BIM held-out sheets", () => {
  it("scores the rules against the models' own centrelines", { timeout: 3_600_000 }, async () => {
    const models = readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((m) =>
        GROUP === "dev" ? BIM_DEV.includes(m) : GROUP === "held" ? BIM_HELD_OUT.includes(m) : true,
      )
      .sort();
    expect(models.length, `no model folders under ${DIR}`).toBeGreaterThan(0);
    // A group that names folders which are not there would silently score a
    // subset, and a subset of a held-out set is not a held-out set.
    if (GROUP !== "") {
      const want = GROUP === "dev" ? BIM_DEV : BIM_HELD_OUT;
      expect(models.length, `BIM_GROUP=${GROUP} wanted ${want.join(", ")}`).toBe(want.length);
    }
    console.log(`group: ${GROUP === "" ? "ALL" : GROUP} — ${models.join(", ")}`);
    if (OUT) mkdirSync(OUT, { recursive: true });

    const rows: Row[] = [];

    for (const model of models) {
      const here = join(DIR, model);
      const sheets = readdirSync(here)
        .filter((f) => f.endsWith(".json"))
        .filter((f) => ONLY === "" || ONLY.split(",").some((p) => f.includes(p)))
        .sort();

      for (const jsonName of sheets) {
        const key = JSON.parse(readFileSync(join(here, jsonName), "utf8")) as BimKey;
        const pdf = join(here, jsonName.replace(/\.json$/, ".pdf"));
        const bytes = Buffer.from(readFileSync(pdf));
        const read = await sheetStrokes(bytes, 1);
        // ── THE SHEET'S OWN TEXT, BECAUSE SEVERAL RULES NEED IT ──
        //
        // This passed `textItems: []` and the scale-bar rule needs three bare
        // numbers printed along the run to recognise a ruler. With no text it
        // can never fire, so 64 ft of scale bar was blamed on the rule missing
        // it when the rule had not been given anything to read. The same
        // starvation silences the wall-type tags and the view split.
        const doc = await openPlanPdf(bytes);
        const pageText = await doc.pageText(1);
        const textItems = pageText.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        }));
        if (read === null) {
          console.log(`${key.id}: could not be read`);
          continue;
        }

        const [widthPt, heightPt] = key.page_size_pt;
        const ptPerFt = key.views[0]?.pt_per_ft ?? 1;
        const feetPerUnit = widthPt / ptPerFt;
        // The finder works in page-width units with y down; the key is PDF
        // user space with y up.
        const toUnits = (xPt: number, yPt: number) => ({ x: xPt / widthPt, y: (heightPt - yPt) / widthPt });

        const keyWalls = key.walls.map((w) => {
          const a = toUnits(w.centerline_pt[0][0], w.centerline_pt[0][1]);
          const b = toUnits(
            w.centerline_pt[w.centerline_pt.length - 1][0],
            w.centerline_pt[w.centerline_pt.length - 1][1],
          );
          return { ...w, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        });

        // What each key stroke IS, so an extra run can be blamed on something
        // rather than merely counted.
        const typeOf = new Map(key.features.map((f) => [f.id, f.type]));
        const keyLines = key.pieces.segments.map((s) => {
          const a = toUnits(s[0], s[1]);
          const b = toUnits(s[2], s[3]);
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, type: typeOf.get(s[4]) ?? "unknown" };
        });

        const found = findWallsOnSheet({
          segments: read.segments,
          textItems,
          pageSize: { widthPt, heightPt },
          feetPerUnit,
          wallTypes: [],
          sampledSheets: null,
        });
        const runs = found.walls;

        const missBy = new Map<string, number>();
        const extraBy = new Map<string, number>();
        let missAll = 0;
        let missNoFur = 0;
        for (const kw of keyWalls) {
          const onIt = runs.filter((r) => onTheLine(kw, r, feetPerUnit));
          const spans = onIt
            .map((r) => spanAlong(kw, r))
            .filter((x): x is { from: number; to: number } => x !== null);
          const inUnits = lengthOf(kw) || 1;
          const coveredShare = Math.min(1, unionLength(spans) / inUnits);
          const shortBy = kw.length_ft * (1 - coveredShare);
          if (shortBy <= 0.01) continue;
          missAll += shortBy;
          if (kw.role !== "furring") missNoFur += shortBy;
          // The cause, in the order a reader would ask: not drawn at all,
          // then curved, then thin, then plain.
          const why = !kw.cut_by_plan
            ? "not cut by the plan"
            : kw.curved
              ? "curved"
              : kw.thickness_in < 3
                ? `thin (<3in, ${kw.role})`
                : kw.length_ft < 3
                  ? "short (<3 ft)"
                  : `plain ${kw.role}`;
          bump(missBy, why, shortBy);
        }

        let extraAll = 0;
        let extraNoFur = 0;
        for (const r of runs) {
          // Feet of this run that lie on no key wall, the same union the other
          // way round — a run half on a wall and half across a corridor is
          // half a phantom, not all or nothing.
          const asLine = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
          const runUnits = lengthOf(asLine) || 1;
          const onAnyShare = Math.min(
            1,
            unionLength(
              keyWalls
                .filter((kw) => onTheLine(kw, r, feetPerUnit))
                .map((kw) => spanAlong(asLine, kw))
                .filter((x): x is { from: number; to: number } => x !== null),
            ) / runUnits,
          );
          const onNonFurShare = Math.min(
            1,
            unionLength(
              keyWalls
                .filter((kw) => kw.role !== "furring" && onTheLine(kw, r, feetPerUnit))
                .map((kw) => spanAlong(asLine, kw))
                .filter((x): x is { from: number; to: number } => x !== null),
            ) / runUnits,
          );
          extraAll += r.lengthFeet * (1 - onAnyShare);
          extraNoFur += r.lengthFeet * (1 - onNonFurShare);
          if (onAnyShare > 0.99) continue;
          // Blame it on whatever the key's own strokes say is there.
          const band = Math.max(r.thicknessFeet / feetPerUnit, 0.003);
          const near = new Map<string, number>();
          for (const kl of keyLines) {
            if (kl.type === "wall") continue;
            if (parallelism(kl, r) < 0.9) continue;
            if (offLine(r, (kl.x1 + kl.x2) / 2, (kl.y1 + kl.y2) / 2) > band * 2) continue;
            const ov = overlapOf(r, kl);
            if (ov <= 0) continue;
            near.set(kl.type, (near.get(kl.type) ?? 0) + ov);
          }
          const blame = [...near.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "nothing in the key";
          bump(extraBy, blame, r.lengthFeet * (1 - onAnyShare));
        }

        rows.push({
          id: key.id,
          model,
          storey: key.storey,
          renderer: key.renderer,
          keyAll: key.totals.wall_lf_total,
          keyNoFur: key.totals.wall_lf_without_furring,
          foundFt: runs.reduce((n, r) => n + r.lengthFeet, 0),
          missAll,
          extraAll,
          missNoFur,
          extraNoFur,
          runs: runs.length,
          missBy,
          extraBy,
        });

        if (OUT) {
          const w = 1400;
          const h = Math.round((heightPt / widthPt) * w);
          const px = (u: number) => (u * w).toFixed(1);
          const parts: string[] = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
            `<rect width="${w}" height="${h}" fill="#fff"/>`,
            `<g stroke="#c9ced6" stroke-width="0.6" fill="none">`,
          ];
          for (const s of read.segments) {
            const a = toUnits(s.x1, s.y1);
            const b = toUnits(s.x2, s.y2);
            parts.push(`<path d="M${px(a.x)} ${px(a.y)}L${px(b.x)} ${px(b.y)}"/>`);
          }
          parts.push(`</g><g stroke="#16a34a" stroke-width="2.4" fill="none" opacity="0.75">`);
          for (const kw of keyWalls) {
            parts.push(`<path d="M${px(kw.x1)} ${px(kw.y1)}L${px(kw.x2)} ${px(kw.y2)}"/>`);
          }
          parts.push(`</g><g stroke="#e11d48" stroke-width="1.6" fill="none">`);
          for (const r of runs) {
            parts.push(`<path d="M${px(r.x1)} ${px(r.y1)}L${px(r.x2)} ${px(r.y2)}"/>`);
          }
          parts.push(`</g></svg>`);
          writeFileSync(join(OUT, `${key.id}.svg`), parts.join("\n"), "utf8");
        }
      }
    }

    // ── PER SHEET ──
    const pc = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
    console.log(
      `\n${"sheet".padEnd(34)} ${"rend".padEnd(10)} | ${"key".padStart(7)} ${"miss".padStart(7)} ${"extra".padStart(7)} ${"net".padStart(7)}` +
        ` | ${"keyNF".padStart(7)} ${"missNF".padStart(7)} ${"extraNF".padStart(7)} ${"netNF".padStart(7)}`,
    );
    for (const r of rows) {
      console.log(
        `${r.id.slice(0, 33).padEnd(34)} ${r.renderer.padEnd(10)} | ${r.keyAll.toFixed(0).padStart(7)}` +
          ` ${r.missAll.toFixed(0).padStart(7)} ${r.extraAll.toFixed(0).padStart(7)} ${(r.extraAll - r.missAll).toFixed(0).padStart(7)}` +
          ` | ${r.keyNoFur.toFixed(0).padStart(7)} ${r.missNoFur.toFixed(0).padStart(7)} ${r.extraNoFur.toFixed(0).padStart(7)}` +
          ` ${(r.extraNoFur - r.missNoFur).toFixed(0).padStart(7)}`,
      );
    }

    // ── BY RENDERER ──
    console.log(`\nBY RENDERER`);
    console.log(
      `${"renderer".padEnd(12)} ${"sheets".padStart(6)} ${"key ft".padStart(9)} ${"missing".padStart(9)} ${"extra".padStart(9)}` +
        ` ${"miss%".padStart(7)} ${"extra%".padStart(7)} | ${"missNF%".padStart(8)} ${"extraNF%".padStart(9)}`,
    );
    for (const renderer of [...new Set(rows.map((r) => r.renderer))].sort()) {
      const g = rows.filter((r) => r.renderer === renderer);
      const sum = (f: (r: Row) => number) => g.reduce((n, r) => n + f(r), 0);
      console.log(
        `${renderer.padEnd(12)} ${String(g.length).padStart(6)} ${sum((r) => r.keyAll).toFixed(0).padStart(9)}` +
          ` ${sum((r) => r.missAll).toFixed(0).padStart(9)} ${sum((r) => r.extraAll).toFixed(0).padStart(9)}` +
          ` ${pc(sum((r) => r.missAll), sum((r) => r.keyAll)).padStart(7)} ${pc(sum((r) => r.extraAll), sum((r) => r.keyAll)).padStart(7)}` +
          ` | ${pc(sum((r) => r.missNoFur), sum((r) => r.keyNoFur)).padStart(8)}` +
          ` ${pc(sum((r) => r.extraNoFur), sum((r) => r.keyNoFur)).padStart(9)}`,
      );
    }

    // ── BY MODEL ──
    console.log(`\nBY MODEL`);
    for (const model of [...new Set(rows.map((r) => r.model))].sort()) {
      const g = rows.filter((r) => r.model === model);
      const sum = (f: (r: Row) => number) => g.reduce((n, r) => n + f(r), 0);
      console.log(
        `${model.padEnd(22)} ${String(g.length).padStart(3)} sheets  key ${sum((r) => r.keyAll).toFixed(0).padStart(6)} ft` +
          `  missing ${pc(sum((r) => r.missAll), sum((r) => r.keyAll)).padStart(6)}` +
          `  extra ${pc(sum((r) => r.extraAll), sum((r) => r.keyAll)).padStart(6)}`,
      );
    }

    // ── CAUSES ──
    const roll = (pick: (r: Row) => Map<string, number>) => {
      const all = new Map<string, number>();
      for (const r of rows) for (const [k, v] of pick(r)) bump(all, k, v);
      return [...all.entries()].sort((a, b) => b[1] - a[1]);
    };
    const totalKey = rows.reduce((n, r) => n + r.keyAll, 0);
    console.log(`\nWHY WALL IS MISSED (feet across all ${rows.length} sheets)`);
    for (const [why, ft] of roll((r) => r.missBy)) {
      console.log(`  ${ft.toFixed(0).padStart(8)} ft  ${pc(ft, totalKey).padStart(6)}  ${why}`);
    }
    console.log(`\nWHAT THE EXTRA SITS ON`);
    for (const [why, ft] of roll((r) => r.extraBy)) {
      console.log(`  ${ft.toFixed(0).padStart(8)} ft  ${pc(ft, totalKey).padStart(6)}  ${why}`);
    }

    const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
    console.log(
      `\nWHOLE SET  ${rows.length} sheets, ${sum((r) => r.keyAll).toFixed(0)} key ft` +
        `\n  with furring:    missing ${sum((r) => r.missAll).toFixed(0)} (${pc(sum((r) => r.missAll), sum((r) => r.keyAll))})` +
        `  extra ${sum((r) => r.extraAll).toFixed(0)} (${pc(sum((r) => r.extraAll), sum((r) => r.keyAll))})` +
        `  net ${(sum((r) => r.extraAll) - sum((r) => r.missAll)).toFixed(0)}` +
        `\n  without furring: missing ${sum((r) => r.missNoFur).toFixed(0)} (${pc(sum((r) => r.missNoFur), sum((r) => r.keyNoFur))})` +
        `  extra ${sum((r) => r.extraNoFur).toFixed(0)} (${pc(sum((r) => r.extraNoFur), sum((r) => r.keyNoFur))})` +
        `  net ${(sum((r) => r.extraNoFur) - sum((r) => r.missNoFur)).toFixed(0)}`,
    );

    expect(rows.length, "no sheet produced a score").toBeGreaterThan(0);
  });
});
