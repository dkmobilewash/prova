import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../plan-ingest/planPdf";
import { findWallsOnSheet, type FindWallsInput, type SheetTextItem } from "./findWallsOnSheet";

/**
 * ── WITH THE SWITCH OFF, THE FINDER'S OUTPUT IS WHAT IT WAS ──
 *
 * The promise behind `PLAN_TEXT_READ` is that nothing changes until somebody
 * turns it on. This holds that promise against the REAL training sheets —
 * every labelled sheet under `TAKEOFF_LABEL_DIR`, read from `REAL_PLAN_DIR`
 * at the label's own scale — by running the finder as it is now, with no
 * `planText`, beside the finder as it was before the switch existed, and
 * requiring the two results to be the same JSON, run for run and group for
 * group.
 *
 * The baseline is the pre-change file dropped beside this one as
 * `zzBaselineFindWalls.ts` (`git show bda8c1a0:apps/web/lib/takeoff/
 * findWallsOnSheet.ts > …`), untracked; the test skips without it rather than
 * compare the new code with itself, which would prove nothing. Skips without
 * the drawings for the same reason, and asserts a sheet was actually
 * compared, because a run over zero sheets is a green over nothing.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const BASELINE = join(__dirname, "zzBaselineFindWalls.ts");

type LabelFile = { set: string; page: number; feetPerUnit: number };

/** The label file's set name is the PDF's name with `/[^\w.-]/` runs replaced by `_`. */
function pdfFor(labelSet: string): string | null {
  const wanted = labelSet.replace(/[^A-Za-z0-9.]+/g, "").toUpperCase();
  for (const dir of [DIR, join(DIR, "new")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase().endsWith(".pdf") && name.replace(/[^A-Za-z0-9.]+/g, "").toUpperCase() === wanted) return join(dir, name);
    }
  }
  return null;
}

describe.skipIf(DIR === "" || LABELS === "" || !existsSync(BASELINE))("PLAN_TEXT_READ off", () => {
  it("leaves the finder's result on every labelled training sheet byte-for-byte as it was", { timeout: 1_800_000 }, async () => {
    const baseline = (await import("./zzBaselineFindWalls")) as { findWallsOnSheet: (input: FindWallsInput) => unknown };
    const labels: { file: string; label: LabelFile }[] = [];
    for (const set of readdirSync(LABELS)) {
      const dir = join(LABELS, set);
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".json")) labels.push({ file: join(dir, name), label: JSON.parse(readFileSync(join(dir, name), "utf8")) as LabelFile });
      }
    }
    let compared = 0;
    for (const { file, label } of labels) {
      // Held-out sets are not opened for plan-text work; the four are named in heldOutSets.ts.
      if (/CENTRAL|GEN.?BBQ|SLN|STEM/i.test(label.set)) continue;
      const pdf = pdfFor(label.set);
      if (pdf === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      try {
        const strokes = await doc.pageStrokes(label.page);
        const text = await doc.pageText(label.page);
        const textItems: SheetTextItem[] = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const input: FindWallsInput = {
          segments: strokes.segments,
          textItems,
          pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
          feetPerUnit: label.feetPerUnit,
          wallTypes: [{ id: "t1", code: "A1", name: "A1", hasParts: true, thicknessIn: 4.875 }],
          sampledSheets: null,
        };
        const now = JSON.stringify(findWallsOnSheet({ ...input }), replacer);
        const was = JSON.stringify(baseline.findWallsOnSheet({ ...input }), replacer);
        expect(now, `${file} (p${label.page})`).toBe(was);
        compared += 1;
        console.log(`same: ${label.set} p${label.page} — ${now.length.toLocaleString()} bytes of result`);
      } finally {
        await doc.close().catch(() => {});
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});

/** `regroup` is a function and cannot be compared as JSON; everything else is data. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === "function" ? undefined : value;
}
