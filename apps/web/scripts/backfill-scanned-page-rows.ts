import { describe, localDatabaseProblem } from "../../../packages/db/scripts/connection-target.mjs";

/**
 * Page rows for scanned sheets rastered BEFORE the RASTER stage wrote them:
 * one `scannedPageRow` per `PlanSheetRaster` row that has no `TakeoffPlanPage`,
 * by the stage's own rules (label from the OCR-read sheet number; a scale
 * reading and a calibration only where OCR read a printed scale that fits the
 * sheet). A page that already has a row is not touched.
 *
 *     DATABASE_URL=postgresql://…@localhost:5432/prova_dev \
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts                 # dry run: list, write nothing
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts --write          # every plan
 *     pnpm --filter @prova/web exec tsx scripts/backfill-scanned-page-rows.ts --write <planId> # one plan
 *
 * ── IT REFUSES ANYTHING BUT A LOCAL DATABASE, AND THERE IS NO OVERRIDE ──
 *
 * With `--write` this creates calibrations, and a calibration is the number
 * every quantity on the sheet is multiplied by. Run with production's
 * `DATABASE_URL` in the shell it would write scales onto real plans, so it
 * does what the db suite does (`vitest.db.setup.mts`): refuses, before
 * Prisma is even loaded, unless the host is localhost, 127.0.0.1, [::1] or
 * one local unix socket. A printed host is information, not a guard — the
 * `--shadow-database-url` entry in CLAUDE.md is what a comment-as-guard
 * costs. `DATABASE_URL` must be in the shell: an unset one is refused rather
 * than letting an `.env` somewhere choose the target. The host is printed,
 * never the credentials. Idempotent: a second run finds nothing to do.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const problem = localDatabaseProblem(url, "DATABASE_URL");
  if (problem) {
    console.error(`backfill scanned page rows REFUSED: ${problem}`);
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const planId = args.find((a) => !a.startsWith("--"));
  console.log(`backfill scanned page rows: database ${describe(url)?.label}; ${write ? "WRITING" : "dry run — pass --write to write"}; ${planId ? `plan ${planId}` : "every plan"}`);
  // Loaded only once the target is known to be local, so a refusal never opens a connection.
  const { backfillScannedPageRows } = await import("../lib/plan-ingest/scannedPageRow");
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
