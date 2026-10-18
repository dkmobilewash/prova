import { prisma } from "@prova/db";
import { runPublicWorksSync } from "../lib/public-works/sync";

/**
 * The scheduled form of the public-works sync: pull slices of the state's
 * record until nothing is older than a week or the budget is spent. Run by
 * `.github/workflows/public-works-sync.yml` daily, or by hand:
 *
 *     pnpm --filter @prova/web public-works:sync          # 50-minute budget
 *     PUBLIC_WORKS_BUDGET_MINUTES=5 pnpm --filter @prova/web public-works:sync
 *
 * Writes only to PublicWorksFirm / PublicWorksSignal / PublicWorksSyncSlice.
 * Every write is idempotent, so a run killed halfway loses nothing but time.
 * The host it talks to is printed first, never the credentials — the same
 * rule as every other script in this repo.
 */
async function main() {
  const budgetMs = Number(process.env.PUBLIC_WORKS_BUDGET_MINUTES ?? "50") * 60_000;
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`public-works sync: database host ${host || "(unset)"}, budget ${budgetMs / 60_000} min`);
  const started = Date.now();
  let rounds = 0;
  for (;;) {
    const report = await runPublicWorksSync({ prisma, budgetMs: Math.max(0, budgetMs - (Date.now() - started)) });
    rounds++;
    for (const s of report.slices) {
      console.log(`  ${s.key}: ${s.rows} rows${s.matched !== undefined ? `, ${s.matched} matched, ${s.unmatched} unmatched` : ""}${s.note ? ` (${s.note})` : ""}`);
    }
    if (report.stoppedBy === "nothing-stale" || Date.now() - started > budgetMs) {
      console.log(`public-works sync: ${report.stoppedBy} after ${rounds} round(s), ${Math.round((Date.now() - started) / 1000)}s`);
      break;
    }
  }
  const [firms, signals, slices] = await Promise.all([
    prisma.publicWorksFirm.count(),
    prisma.publicWorksSignal.count(),
    prisma.publicWorksSyncSlice.count(),
  ]);
  console.log(`public-works sync: ${firms} firms, ${signals} signals, ${slices} slices bookmarked`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
