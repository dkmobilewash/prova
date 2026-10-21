import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";

/**
 * ── WHAT KIND OF THING IS THE FINDER CALLING A WALL? ──
 *
 * The held-out score says the finder's trouble is EXTRA footage — 6,516 ft of
 * it against 1,844 ft missing. That tells you the direction and nothing about
 * what to fix. This breaks the extra into KINDS, in feet, so the next rule to
 * write is the one with the most feet behind it rather than the one somebody
 * remembers being annoyed by.
 *
 * ── TRAINING SHEETS ONLY ──
 *
 * `heldOutReason` refuses the test buildings, for the same reason the row
 * builder does: reading what the finder gets wrong on a held-out sheet and
 * then writing a rule for it is tuning on the test key, whatever the rule
 * looks like afterwards.
 *
 * ── A KIND IS A GUESS, AND THE CROPS ARE WHERE IT IS CHECKED ──
 *
 * Every kind here is inferred from layer names, nearby text, hatch membership
 * and geometry. None of it is ground truth: the labels say wall or not-wall
 * and nothing else. So the totals are a RANKING to aim at, not a measurement
 * of cause, and `--crops` writes examples of each kind for a person to
 * disagree with. "other" staying large is the honest outcome if the guesses
 * are poor, and it is reported rather than squeezed.
 *
 *     REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzRejectKinds.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    verdict: string;
  }[];
};

type Kind =
  | "hatching"
  | "dimension/leader"
  | "casework/equipment"
  | "face-only duplicate"
  | "room-label/text"
  | "grid line"
  | "outside the building"
  | "elevation/detail"
  | "other";

const KINDS: Kind[] = [
  "hatching",
  "dimension/leader",
  "casework/equipment",
  "face-only duplicate",
  "room-label/text",
  "grid line",
  "outside the building",
  "elevation/detail",
  "other",
];

type Example = { sheet: string; kind: Kind; feet: number; x1: number; y1: number; x2: number; y2: number };

const len = (a: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(a.x2 - a.x1, a.y2 - a.y1);

/** Perpendicular distance from a's infinite line to a point, in feet. */
function offLine(
  a: { x1: number; y1: number; x2: number; y2: number },
  px: number,
  py: number,
  fpu: number,
): number {
  const L = len(a);
  if (L === 0) return Math.hypot(px - a.x1, py - a.y1) * fpu;
  const num = Math.abs(
    (a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1),
  );
  return (num / L) * fpu;
}

function parallel(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot = ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > 0.985;
}

describe.skipIf(DIR === "" || LABELS === "")("what the finder's extra footage IS", () => {
  it("breaks the rejected candidates into kinds, in feet", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here)) continue;
      for (const name of readdirSync(here)) {
        if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
      }
    }

    const feet = new Map<Kind, number>(KINDS.map((k) => [k, 0]));
    const counts = new Map<Kind, number>(KINDS.map((k) => [k, 0]));
    const examples: Example[] = [];
    const sheetsRead: string[] = [];
    let refused = 0;

    for (const file of files) {
      // ── THE TEST BUILDINGS ARE REFUSED HERE TOO ──
      if (heldOutReason(file.dir) !== null) {
        refused += 1;
        continue;
      }
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const read = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const items = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
      const found = findWallsOnSheet({
        segments: read.segments,
        textItems: items,
        pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      sheetsRead.push(`${file.dir}/${file.sheet}`);

      // ── TEXT IS IN POINTS, CANDIDATES ARE NORMALISED BY WIDTH ──
      //
      // `pageText` returns `x`/`y` in POINTS (planPdf.ts: the viewport
      // transform's translation), and a candidate's coordinates are divided
      // by `widthPt`. Comparing the two directly makes every distance
      // enormous, so all four text-based kinds came back at EXACTLY zero —
      // which is the shape of a units bug rather than of a clean sheet.
      const near = items.map((i) => ({
        str: i.str,
        x: i.x / read.widthPt,
        y: i.y / read.widthPt,
      }));

      const fpu = saved.feetPerUnit;
      const realWalls = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced");
      // ── WHY THE FINDER'S OWN STAGES ARE NOT USED HERE ──
      //
      // `everywhere` -> `inBuilding` -> `notLettering` -> `notBorder` ->
      // `walls` looked like free ground truth. It is not, twice over: a
      // SURVIVING wall is by definition past every filter, so membership
      // carries no information about it, and the stages return copies rather
      // than the same objects, so a Set of them matches nothing anyway. The
      // first version of this file scored 100% of 10,602 ft as "outside the
      // building" on exactly that mistake.
      //
      // So every kind below is a heuristic over text, geometry and the key.
      // The box of the key's own walls stands in for the building.
      const keyBox = realWalls.reduce(
        (b, k) => ({
          x1: Math.min(b.x1, k.x1, k.x2),
          y1: Math.min(b.y1, k.y1, k.y2),
          x2: Math.max(b.x2, k.x1, k.x2),
          y2: Math.max(b.y2, k.y1, k.y2),
        }),
        { x1: 1, y1: 1, x2: 0, y2: 0 },
      );

      // Text that means a dimension (a number, with or without feet/inch
      // marks) against text that names a thing.
      const dimensionText = near.filter((i) => /^[\d'"\-\s./]+$/.test(i.str.trim()) && /\d/.test(i.str));
      const equipText = near.filter((i) =>
        /COUNTER|CASEWORK|MILLWORK|EQUIP|SHELV|CABINET|SINK|REF|FREEZER|COOLER|W\.?I\.?C|OVEN|RANGE|HOOD|FIXTURE/i.test(
          i.str,
        ),
      );
      const namedText = near.filter((i) => /^[A-Z(][A-Z\s().\-/&]{3,}$/.test(i.str.trim()));
      const detailText = near.filter((i) => /ELEVATION|DETAIL|SECTION|SCHEDULE|LEGEND/i.test(i.str));

      for (const w of found.walls) {
        // Is this candidate a real wall in the key? If so it is not extra.
        // The scorer's own band, in FEET on both sides — the first version of
        // this divided by feetPerUnit and then multiplied back, which happens
        // to cancel and would not have if either half were edited.
        const onKey = realWalls.some((k) => {
          if (!parallel(w, k)) return false;
          const band = Math.min(3, Math.max(1.5, Math.max(w.thicknessFeet, k.thicknessFeet) / 2 + 0.5));
          return Math.max(offLine(w, k.x1, k.y1, fpu), offLine(w, k.x2, k.y2, fpu)) <= band;
        });
        if (onKey) continue;

        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        const nearText = (list: typeof near, ft: number) =>
          list.some((i) => Math.hypot(mx - i.x, my - i.y) * fpu <= ft);

        const sheetSpan = Math.max(keyBox.x2 - keyBox.x1, keyBox.y2 - keyBox.y1);
        const axisAligned =
          Math.abs(w.y2 - w.y1) < len(w) * 0.02 || Math.abs(w.x2 - w.x1) < len(w) * 0.02;
        const companions = found.walls.filter(
          (o) =>
            o !== w &&
            parallel(w, o) &&
            offLine(w, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, fpu) <= 3 &&
            o.lengthFeet <= 4,
        ).length;
        const pad = sheetSpan * 0.04;
        const outside =
          mx < keyBox.x1 - pad || mx > keyBox.x2 + pad || my < keyBox.y1 - pad || my > keyBox.y2 + pad;

        let kind: Kind = "other";
        if (outside) {
          kind = "outside the building";
        } else if (axisAligned && len(w) >= sheetSpan * 0.85) {
          // A grid line runs essentially the whole plan.
          kind = "grid line";
        } else if (w.lengthFeet <= 4 && companions >= 4) {
          // Hatching, approximated: `inHatchSeries` is a FEATURE column and
          // `featuresFor` needs the two face segments, which a finished
          // candidate no longer carries. Named as a stand-in rather than
          // presented as the finder's own verdict.
          kind = "hatching";
        } else if (
          realWalls.some(
            (k) =>
              parallel(w, k) &&
              offLine(k, mx, my, fpu) <= Math.max(2, k.thicknessFeet + 1) &&
              Math.abs(w.lengthFeet - k.lengthFeet) <= Math.max(3, k.lengthFeet * 0.5),
          )
        ) {
          // Lies along a real wall at about its length: the same wall
          // proposed again, usually one face of it.
          kind = "face-only duplicate";
        } else if (
          namedText.some(
            (i) =>
              Math.abs(w.y2 - w.y1) < Math.abs(w.x2 - w.x1) * 0.02 &&
              Math.abs((w.y1 + w.y2) / 2 - i.y) * fpu <= 2 &&
              Math.min(w.x1, w.x2) <= i.x &&
              Math.max(w.x1, w.x2) >= i.x,
          )
        ) {
          // A line along a named label's baseline — the Gen BBQ
          // "(E) OFFICE 110" strikethrough.
          kind = "room-label/text";
        } else if (nearText(detailText, 25)) {
          kind = "elevation/detail";
        } else if (nearText(dimensionText, 2.5)) {
          kind = "dimension/leader";
        } else if (nearText(equipText, 8)) {
          kind = "casework/equipment";
        }

        feet.set(kind, (feet.get(kind) ?? 0) + w.lengthFeet);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        if (w.lengthFeet >= 3) {
          examples.push({
            sheet: `${file.dir}/${file.sheet}`,
            kind,
            feet: w.lengthFeet,
            x1: w.x1,
            y1: w.y1,
            x2: w.x2,
            y2: w.y2,
          });
        }
      }
    }

    // ── A RUN OVER NO SHEETS IS NOT A RESULT ──
    // Asserted on a LIST rather than a counter so the shape is the one
    // `harness.test.ts` recognises for a keyless eval, and so the failure can
    // say which sheets it did read.
    expect(
      sheetsRead.length,
      "no training sheets were read — every number below would be a clean zero over nothing",
    ).toBeGreaterThan(0);

    const total = [...feet.values()].reduce((a, b) => a + b, 0);
    console.log(
      `\n${sheetsRead.length} training sheets (${refused} held-out sheets refused) · ` +
        `${total.toFixed(0)} ft of candidates NOT on the key`,
    );
    console.log(`  ${"kind".padEnd(22)} ${"feet".padStart(9)} ${"share".padStart(7)} ${"runs".padStart(6)}`);
    const ranked = [...feet.entries()].sort((a, b) => b[1] - a[1]);
    for (const [kind, ft] of ranked) {
      console.log(
        `  ${kind.padEnd(22)} ${ft.toFixed(0).padStart(9)} ${((ft / total) * 100).toFixed(1).padStart(6)}% ` +
          `${String(counts.get(kind) ?? 0).padStart(6)}`,
      );
    }

    // Examples for the top three, longest first, as crop boxes a renderer can take.
    console.log("\nCROPS");
    for (const [kind] of ranked.slice(0, 3)) {
      const mine = examples
        .filter((e) => e.kind === kind)
        .sort((a, b) => b.feet - a.feet)
        .slice(0, 5);
      for (const e of mine) {
        console.log(
          `  ${kind}\t${e.sheet}\t${e.feet.toFixed(1)}\t` +
            `${e.x1.toFixed(4)}\t${e.y1.toFixed(4)}\t${e.x2.toFixed(4)}\t${e.y2.toFixed(4)}`,
        );
      }
    }
  });
});
