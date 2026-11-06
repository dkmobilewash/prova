import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { money } from "@/lib/money";
import { loadAddendumChanges, type ChangeRow } from "@/lib/takeoff/addendumChanges";

/**
 * ── WHAT THE REVISED SHEETS CHANGE ──
 *
 * The newest drawings on the job against the sheets they replace, matched by
 * sheet number, and what that does to the takeoff by wall type: feet, square
 * feet and dollars (`loadAddendumChanges`). Read-only: nothing here changes the
 * takeoff or the estimate. MANAGE_ESTIMATING, as the proposal: it shows price.
 */
export default async function JobAddendumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const job = await prisma.job.findFirst({ where: { id, companyId: context.company.id }, select: { id: true, name: true } });
  if (!job) notFound();
  const changes = await loadAddendumChanges(context.company.id, job.id);

  const ft = (n: number) => `${Math.round(n).toLocaleString()} LF`;
  const signed = (n: number, unit: string) => (Math.round(n) === 0 ? `0 ${unit}` : `${n > 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()} ${unit}`);
  const dollars = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`);
  const total = changes?.rows.reduce((n, r) => n + (r.deltaDollars ?? 0), 0) ?? 0;
  const unpriced = (changes?.rows ?? []).filter((r: ChangeRow) => r.deltaDollars === null && Math.round(r.deltaFt) !== 0);

  return (
    <PageShell width="reading">
      <div className="mb-6">
        <Link href={`/jobs/${job.id}/takeoff`} className="text-sm text-link hover:underline">
          ← Back to the takeoff
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-ink">What the revised sheets change</h1>
      {changes === null ? (
        <p className="mt-3 text-sm text-ink-body" data-addendum="none">
          The newest drawings on {job.name} replace no sheet of an earlier file. Upload the revised sheets on the Takeoff tab; each is matched to the sheet it replaces by its sheet number.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-body">
            {changes.planLabel}, against the sheets it replaces. Nothing here changes the takeoff or the estimate.
          </p>

          <section className="mt-6" data-addendum="sheets">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-label">Sheets</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-card text-left text-ink-label">
                  <th className="py-2">Sheet</th>
                  <th className="py-2">Replaces</th>
                  <th className="py-2">Walls</th>
                </tr>
              </thead>
              <tbody>
                {changes.sheets.map((s) => (
                  <tr key={s.pageNumber} className="border-b border-line-card" data-addendum="sheet">
                    <td className="py-2 pr-2 font-medium text-ink">{s.sheetNumber}</td>
                    <td className="py-2 pr-2 text-ink-body">{s.replaces === null ? "a new sheet" : `${s.sheetNumber} in ${s.replaces.label}`}</td>
                    <td className="py-2 text-ink-body" data-addendum="sheet-status">
                      {s.status === "compared"
                        ? `compared: ${s.matched} of ${s.runs} runs matched in place`
                        : s.status === "no scale"
                          ? "no scale yet: set it to compare"
                          : s.status === "walls not found yet"
                            ? "walls not found yet: open it and run the takeoff"
                            : s.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-ink-muted">
              A run matched in place keeps the type it had. Few matches on a sheet means the revision moved the drawing on the page: check its walls by hand.
            </p>
          </section>

          <section className="mt-6" data-addendum="changes">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-label">Changes by wall type</h2>
            {changes.rows.length === 0 ? (
              <p className="text-sm text-ink-body" data-addendum="no-changes">
                No wall changes on the sheets compared.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-card text-left text-ink-label">
                    <th className="py-2">Wall type</th>
                    <th className="py-2 text-right">Before</th>
                    <th className="py-2 text-right">After</th>
                    <th className="py-2 text-right">Change</th>
                    <th className="py-2 text-right">Area</th>
                    <th className="py-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.rows.map((r) => (
                    <tr key={r.itemId ?? "new"} className="border-b border-line-card" data-addendum="change">
                      <td className="py-2 pr-2 text-ink">
                        {r.code !== null && <span className="font-semibold">{r.code} · </span>}
                        {r.name}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink-body">{ft(r.oldFt)}</td>
                      <td className="py-2 text-right tabular-nums text-ink-body">{ft(r.newFt)}</td>
                      <td className="py-2 text-right tabular-nums text-ink">{signed(r.deltaFt, "LF")}</td>
                      <td className="py-2 text-right tabular-nums text-ink">{r.deltaSqFt === null ? "—" : signed(r.deltaSqFt, "SF")}</td>
                      <td className="py-2 text-right tabular-nums text-ink">{dollars(r.deltaDollars)}</td>
                    </tr>
                  ))}
                  <tr data-addendum="total">
                    <td className="py-2 font-semibold text-ink" colSpan={5}>
                      Net change in price
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-ink">{dollars(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {unpriced.length > 0 && (
              <p className="mt-1 text-xs text-ink-muted" data-addendum="unpriced">
                Not in the net: {unpriced.map((r) => r.code ?? r.name.toLowerCase()).join(", ")}, which {unpriced.length === 1 ? "has" : "have"} no price yet. New walls take a price once they are typed.
              </p>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
