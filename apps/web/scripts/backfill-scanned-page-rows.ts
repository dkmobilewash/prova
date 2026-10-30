import { backfillScannedPageRows } from "../lib/plan-ingest/scannedPageRow";

/**
 * Page rows for scanned sheets rastered BEFORE the RASTER stage wrote them:
 * one `scannedPageRow` per `PlanSheetRaster` row that has no `TakeoffPlanPage`,
 * by the stage's own rules (label from the OCR-read sheet number; a scale
 * reading and a calibration only where OCR read a printed scale that fits the
 * sheet). A page that already has a row is not touched.
 *
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts                 # dry run: list, write nothing
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts --write          # every plan
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts --write <planId> # one plan
 *
 * Talks to whatever `DATABASE_URL` resolves to (the shell's, else
 * `packages/db/.env`); prints the host first and never the credentials,
 * like every other script here. Idempotent: a second run finds nothing to do.
 */
async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const planId = args.find((a) => !a.startsWith("--"));
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`backfill scanned page rows: database host ${host || "(unset)"}; ${write ? "WRITING" : "dry run — pass --write to write"}; ${planId ? `plan ${planId}` : "every plan"}`);
  const result = await backfillScannedPageRows({ planId, dryRun: !write });
  console.log(`${result.rasters} raster rows; ${result.withRows} already have a page row; ${result.missing.length} without one`);
  for (const m of result.missing) {
    const o = result.outcomes.find((x) => x.planId === m.planId && x.pageNumber === m.pageNumber)?.outcome;
    console.log(`  ${m.planId} p${m.pageNumber}${o ? ` → page ${o.page}, scale ${o.scale}` : ""}`);
  }
  if (write) {
    const scales = new Map<string, number>();
    for (const o of result.outcomes) scales.set(o.outcome.scale, (scales.get(o.outcome.scale) ?? 0) + 1);
    console.log(`wrote ${result.outcomes.length} page rows — ${[...scales].map(([k, n]) => `${k}: ${n}`).join(", ") || "nothing"}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
