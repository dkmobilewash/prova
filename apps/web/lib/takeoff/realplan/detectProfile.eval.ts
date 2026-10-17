import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";

/**
 * ── WHERE THE 102 SECONDS GO ──
 *
 * `AUDIT.md` records the measurement — Find the walls takes 102,134 ms on Camp
 * Bow Wow's A102 — and names profiling as the FIRST thing to do, in as many
 * words: "Everything below is speculation until that exists." This is that.
 *
 * The quadratic pair test is the obvious suspect precisely because
 * `MAX_PAIR_TESTS` exists, which is a reason to measure it rather than a
 * reason to assume it. So this times the whole call and reports the inputs it
 * was given — segment count, text count, page size — for each real sheet,
 * rather than asserting a cause.
 *
 * ── IT CALLS NO MODEL ──
 *
 * `findWallsOnSheet` is deterministic geometry. The drawings are a client's
 * and stay outside the repository; the file skips when they are absent.
 *
 *   REAL_PLAN_DIR="/path/to/sets" npx vitest run -c vitest.eval.config.mts \
 *     lib/takeoff/realplan/detectProfile.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";

/** Which sheets to profile, as `file-fragment:page,page`. */
const SHEETS = (process.env.DETECT_PROFILE_SHEETS ?? "Camp Bow Wow:8,9")
  .split(";")
  .map((part) => {
    const [key, pages] = part.split(":");
    return {
      key,
      pages: (pages ?? "")
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    };
  })
  .filter((entry) => entry.key && entry.pages.length > 0);

describe.skipIf(DIR === "")("where detection spends its time on a real sheet", () => {
  it("profiles the sheets named by DETECT_PROFILE_SHEETS", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    expect(files.length, `no PDFs under ${DIR}`).toBeGreaterThan(0);

    let profiled = 0;

    for (const entry of SHEETS) {
      const file = files.find((f) => f.includes(entry.key));
      if (!file) continue;
      const doc = await openPlanPdf(readFileSync(join(DIR, file)));
      try {
        for (const pageNumber of entry.pages) {
          if (pageNumber > doc.pageCount) continue;

          const tRead = Date.now();
          const { segments } = await doc.pageStrokes(pageNumber);
          const readMs = Date.now() - tRead;

          const text = await doc.pageText(pageNumber);
          const pageSize = { widthPt: text.widthPt, heightPt: text.heightPt };
          // ── POINTS, BECAUSE THAT IS WHAT THE FUNCTION TAKES ──
          //
          // This file used to pre-divide by `widthPt`, and so does
          // `findWallsOnSheet` itself (`allInUnits`, and the same for every
          // text item). So every coordinate arrived divided TWICE, 2592 times
          // too small on a 36" sheet, and nothing threw: lengths are still
          // lengths, they were just all tiny.
          //
          // That is how this profiler reported 126,943 of 143,438 segments as
          // "short pieces" on A102. At 1/2592 scale, everything is short. The
          // whole Phase 4 diagnosis was taken through it — see the correction
          // in AUDIT.md.
          //
          // `FindWallsInput` says it in its own first line: "Every stroked
          // segment on this sheet, in POINTS". The type could not catch this
          // because both forms are the same shape.

          const stages: string[] = [];
          const tFind = Date.now();
          let found: ReturnType<typeof findWallsOnSheet> | null = null;
          let refused: string | null = null;
          try {
            found = findWallsOnSheet({
              segments,
              textItems: text.items.map((i) => ({
                str: i.str,
                x: i.x,
                y: i.y,
                width: i.width,
                height: i.height,
              })),
              pageSize,
              wallTypes: [],
              // Null, not an empty array: the template pass treats null as
              // "the caller could not read other sheets", which is the state
              // this profile is measuring one page in isolation from.
              sampledSheets: null,
              onStage: (name, ms) => {
                if (ms >= 50 || name.startsWith("curve-pieces")) stages.push(ms > 0 ? `${name} ${ms}ms` : name);
              },
              // A representative scale: 1/8" on a 36in page is 288 ft across.
              feetPerUnit: 288,
            });
          } catch (error) {
            refused = error instanceof Error ? error.message : String(error);
          }
          const findMs = Date.now() - tFind;
          profiled += 1;

          // eslint-disable-next-line no-console -- this eval's output IS its report.
          console.log(
            `[profile] ${basename(file, ".pdf").slice(0, 24)} p${pageNumber}: ` +
              `${segments.length} segments · ${text.items.length} text · ` +
              `read ${readMs}ms · find ${findMs}ms` +
              (refused ? ` · REFUSED: ${refused}` : ` · ${found?.clusters.length ?? 0} groups`) +
              (stages.length > 0 ? `\n           stages: ${stages.join(" · ")}` : ""),
          );
        }
      } finally {
        await doc.close?.();
      }
    }

    // A PROFILE OF NOTHING IS NOT A PROFILE. A mistyped sheet selector would
    // otherwise print nothing and pass.
    expect(profiled, "no sheet was profiled — check DETECT_PROFILE_SHEETS").toBeGreaterThan(0);
  }, 1_800_000);
});
