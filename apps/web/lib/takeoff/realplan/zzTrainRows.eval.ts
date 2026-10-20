import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { collectSheets } from "../labelCollect";
import { finderVersion } from "../finderVersion";
import { FEATURE_NAMES } from "../wallFeatures";
import type { LabelCandidate } from "../labelRows";

/**
 * ── EVERY LABELLED TRAINING SHEET, TURNED INTO ROWS, ONCE ──
 *
 * The step that used to live in a scratch script outside the repository —
 * which is why `trainingRowsCensus` found nothing to guard for weeks.
 *
 * Three things it does that a scratch script did not:
 *
 *   1. REBUILDS rows from the saved verdicts against candidates the finder
 *      produces NOW, matched by geometry. A label file's stored rows belong
 *      to the finder that wrote them, position by position, and this finder
 *      is not that one — Camp Bow Wow A120's saved `21.7 ft / 3.8 in` had
 *      become `22.6 ft / 7.7 in` within days.
 *   2. Refuses the four held-out buildings through `trainingRows`, and says
 *      what it refused. A run that silently skipped four sets looks exactly
 *      like a run that never had them.
 *   3. Reports the POSITIVES PER BUILDING. Six labelled sheets once turned
 *      out to be three buildings with 89% of the positives in one of them,
 *      and the model transferred to nothing. That number belongs in front of
 *      whoever starts a training run, not in a notebook afterwards.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… \
 *       TRAIN_ROWS_OUT=/tmp/rows.jsonl \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzTrainRows.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.TRAIN_ROWS_OUT ?? "";
/** Appends instead of truncating, so synthetic rows can be written first. */
const APPEND = process.env.TRAIN_ROWS_APPEND === "1";

type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  reviewComplete: boolean;
  finderVersion?: string;
  rows: unknown[];
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

describe.skipIf(DIR === "" || LABELS === "")("building the training rows", () => {
  it("rebuilds every labelled sheet by geometry", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
    const now = finderVersion();

    const files: { dir: string; sheet: string; path: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const full = join(LABELS, dir);
      if (!existsSync(full)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) files.push({ dir, sheet: name.slice(0, -5), path: join(full, name) });
    }
    expect(files.length, "no label files — check TAKEOFF_LABEL_DIR").toBeGreaterThan(0);

    // Typed from the collector itself, so the verdict union stays in one
    // place rather than being restated and drifting.
    const prepared: Parameters<typeof collectSheets>[0][number][] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) {
        skipped.push(`${file.dir}/${file.sheet}: no ingested plan`);
        continue;
      }
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const read = await sheetStrokes(bytes, saved.page);
      if (read === null) {
        skipped.push(`${file.dir}/${file.sheet}: unreadable`);
        continue;
      }
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      // ── FEATURES COME FROM THE FINDER'S OWN HOOK ──
      //
      // `findWallsOnSheet` hands each candidate's feature vector to
      // `onCandidate` as it builds it. A row's features must be the ones the
      // product would compute for that candidate, so they are taken from the
      // finder rather than recomputed here — two implementations of a feature
      // vector is how a model gets trained on numbers the app never produces.
      const candidates: LabelCandidate[] = [];
      findWallsOnSheet({
        segments: read.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
        onCandidate: (features, wall) =>
          candidates.push({
            x1: wall.x1,
            y1: wall.y1,
            x2: wall.x2,
            y2: wall.y2,
            lengthFeet: wall.lengthFeet,
            thicknessFeet: wall.thicknessFeet,
            features,
          }),
      });
      if (candidates.length === 0) {
        skipped.push(`${file.dir}/${file.sheet}: the finder offered no candidates`);
        continue;
      }
      prepared.push({
        saved: {
          ...saved,
          set: saved.set === "" ? file.dir : saved.set,
          verdicts: saved.verdicts.map((v) => ({
            ...v,
            verdict: v.verdict as "wall" | "not-wall" | "traced" | "unsure",
          })),
        },
        candidates,
      });
    }

    const { training, collected, staleFinders } = collectSheets(prepared, now);

    // ── POSITIVES PER BUILDING, BEFORE ANYTHING IS TRAINED ──
    const perFamily = new Map<string, { rows: number; positive: number; sheets: Set<string> }>();
    for (const row of training.rows) {
      const at = perFamily.get(row.family) ?? { rows: 0, positive: 0, sheets: new Set<string>() };
      at.rows += 1;
      at.positive += row.label;
      at.sheets.add(row.case);
      perFamily.set(row.family, at);
    }
    const totalPositive = training.counts.positive;
    const families = [...perFamily.entries()].sort((a, b) => b[1].positive - a[1].positive);
    const biggest = families[0];
    const share = totalPositive === 0 ? 0 : ((biggest?.[1].positive ?? 0) / totalPositive) * 100;

    if (OUT !== "") {
      const lines = training.rows
        .map((r: (typeof training.rows)[number]) =>
          JSON.stringify({
            case: r.case,
            family: r.family,
            features: r.features,
            label: r.label,
            lengthFt: r.lengthFt,
          }),
        )
        .join("\n");
      if (APPEND) appendFileSync(OUT, `${lines}\n`, "utf8");
      else writeFileSync(OUT, `${lines}\n`, "utf8");
      // ── THE COLUMN NAMES TRAVEL WITH THE ROWS ──
      //
      // The trainer takes them on the command line, and a model whose columns
      // do not match this build's features scores noise while looking fine.
      // Written from `FEATURE_NAMES` itself so there is one source.
      writeFileSync(`${OUT}.columns`, `${FEATURE_NAMES.join(",")}\n`, "utf8");
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n${training.counts.rows} rows from ${training.counts.sheets} sheets ` +
        `across ${training.counts.families} buildings, ${totalPositive} positive\n` +
        `${families
          .map(
            ([family, at]) =>
              `  ${family.slice(0, 34).padEnd(34)} ${String(at.positive).padStart(5)} positive ` +
              `of ${String(at.rows).padStart(6)} rows · ${at.sheets.size} sheet(s)`,
          )
          .join("\n")}\n` +
        `  BIGGEST BUILDING holds ${share.toFixed(0)}% of the positives` +
        (share >= 60 ? "  ← one building dominates; a model may transfer to nothing" : "") +
        `\n` +
        (training.counts.sheetsRefused === 0
          ? "  no held-out sets were present\n"
          : `  refused (held out, their labels are the TEST key): ${training.refused
              .map((r: (typeof training.refused)[number]) => `${r.set} ${r.sheet} (${r.rows} rows)`)
              .join(", ")}\n`) +
        (staleFinders === 0
          ? "  every label file was written by this finder\n"
          : `  ${staleFinders} of ${collected.length} sheets were labelled by a DIFFERENT finder — ` +
            `rows rebuilt by geometry\n`) +
        (skipped.length === 0 ? "" : `  skipped: ${skipped.join("; ")}\n`) +
        (OUT === "" ? "  (set TRAIN_ROWS_OUT to write them)" : `  wrote ${OUT}`),
    );

    // The harness, not the score: every sheet must be accounted for.
    expect(
      training.counts.sheets + training.counts.sheetsRefused + skipped.length,
      "sheets went missing between the label directory and the rows",
    ).toBe(files.length);
    expect(training.counts.rows, "no rows were built").toBeGreaterThan(0);
  });
});
