// Across every TRAINING set: offered sheets where ONE scale is printed (caption
// or title block) and the dimension labels, measured, cluster at a RATIO to it.
// Prints the ratio histogram per sheet and flags 2x / 0.5x reproductions.
import { readFileSync, writeFileSync } from "node:fs";
import { dimensionLabels, metricDimensionLabels } from "@/lib/plan-ingest/dimensionLabels";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { printedScalesOnPage } from "@/lib/takeoff/scaleAudit";
import { ARCHITECTURAL_SCALES, readSheetScale, scaleCandidates } from "@/lib/takeoff/scaleFromDimensions";
import { sheetViews } from "@/lib/takeoff/sheetViews";
import { takeoffSheetVerdict } from "@/lib/takeoff/takeoffSheet";
const NEW = `${process.env.HOME}/Claude Folder/takeoff/real-plans/new`;
const OLD = `${process.env.HOME}/Claude Folder/takeoff/real-plans`;
const TRAINING = [
  `${NEW}/2025.07.08_Baker_EOC_BID.pdf`, `${NEW}/BUNKIE-BID-DRAWINGS.pdf`, `${OLD}/Camp Bow Wow - 100% CD_ARCH (2) (1).pdf`,
  `${NEW}/Crosslines-Phase-II-Drawings.pdf`, `${NEW}/E_Street_421-Set.pdf`, `${NEW}/MHK_FOR-BID-SET.pdf`, `${NEW}/IFBREBID-Murray-Tower-Package.pdf`,
  `${NEW}/NG-Green-Bay-WI.pdf`, `${NEW}/SW-Grand-Junction-CO.pdf`, `${OLD}/2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf`,
  `${NEW}/Topeka-Senior-Villas.pdf`, `${NEW}/Camp-Clark-60-Soldier-Barracks.pdf`, `${NEW}/Missouri-State-Fairgrounds-New-Comfort-Station.pdf`,
  `${NEW}/Supreme-Court-of-Missouri-Judiciary-Library.pdf`, `${NEW}/Joplin-community-center.pdf`, `${NEW}/NG-McAllen-TX.pdf`,
];
const TOL = 0.02;
async function main() {
  const out: Record<string, unknown[]> = {};
  for (const path of TRAINING) {
    const name = path.split("/").pop()!;
    const doc = await openPlanPdf(Buffer.from(readFileSync(path)));
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= doc.pageCount; page++) {
      const text = await doc.pageText(page);
      const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      if (items.length < 20) continue;
      const r = sheetNumberFrom({ pageNumber: page, widthPt: text.widthPt, heightPt: text.heightPt, rotation: 0, items });
      const views = sheetViews(items, text.widthPt);
      const verdict = takeoffSheetVerdict({ sheetNumber: r.sheetNumber, title: r.regionText, viewNames: views.map((v) => v.name) });
      if (!verdict.worthMeasuring) continue;
      const captioned = [...new Set(views.filter((v) => v.feetPerInch !== null).map((v) => v.scaleName as string))];
      const printed = printedScalesOnPage(items);
      const single = captioned.length === 1 ? captioned[0] : printed.length === 1 ? printed[0] : null;
      if (single === null) continue;
      const fpi = ARCHITECTURAL_SCALES.find((s) => s.name === single)?.feetPerInch ?? null;
      if (fpi === null) continue;
      const strokes = await doc.pageStrokes(page);
      const labels = dimensionLabels(text);
      if (labels.length < 3) continue;
      const dims = readSheetScale(text, strokes.segments, labels, {}, metricDimensionLabels(text));
      const cands = scaleCandidates(labels, strokes.segments);
      // One ratio per label: the candidate nearest to any of {1, 2, 0.5}, else its own.
      const perLabel = new Map<string, number>();
      for (const c of cands) {
        const ratio = c.feetPerInch / fpi;
        const prev = perLabel.get(c.labelKey);
        const score = (x: number) => Math.min(Math.abs(x - 1), Math.abs(x - 2), Math.abs(x - 0.5));
        if (prev === undefined || score(ratio) < score(prev)) perLabel.set(c.labelKey, ratio);
      }
      const ratios = [...perLabel.values()];
      const near = (k: number) => ratios.filter((x) => Math.abs(x / k - 1) <= TOL).length;
      const at1 = near(1), at2 = near(2), atHalf = near(0.5);
      const n = ratios.length;
      const flag = n >= 3 && (at2 >= Math.max(3, 0.6 * n) || atHalf >= Math.max(3, 0.6 * n)) && at1 < at2 + atHalf;
      rows.push({ page, sheet: r.sheetNumber, single, dims: dims.ok ? dims.scaleName : null, labels: labels.length, measured: n, at1, at2, atHalf, flag });
      if (flag || (dims.ok === false && n >= 10 && at1 < 0.3 * n)) {
        console.log(`${name} p${page} ${r.sheetNumber ?? "?"} printed ${single}: dims ${dims.ok ? dims.scaleName : "declined"}; ${n} labels measured: x1 ${at1}, x2 ${at2}, x0.5 ${atHalf}${flag ? "  <-- REPRODUCTION" : ""}`);
      }
    }
    await doc.close();
    out[name] = rows;
    console.log(`${name}: ${rows.length} single-scale offered sheets with >=3 labels; flagged ${rows.filter((x) => x.flag).length}`);
  }
  writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
}
void main();
