import Link from "next/link";
import { Button, PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { PageHeader } from "@/components/PageHeader";
import { PreviewLetterDisclosure, PublicWorksLettersStrip } from "@/components/PublicWorksLetters";
import { PublicWorksSyncButton } from "@/components/PublicWorksSyncButton";
import { requireCompanyContext } from "@/lib/auth";
import { keyMode } from "@/lib/letters/lob";
import { configFromEnv, missingConfig } from "@/lib/letters/template";
import { COUNTIES, factFor, tierFor, type Signal, type Tier } from "@/lib/public-works/signals";
import { viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Public works market" };

/**
 * Who is doing certified payroll in California this week, by name, phone
 * and the job — the state's own record, joined to the CSLB licence list.
 * Same gate as /sales: the operating company's owner, nobody else.
 *
 * Tier is DERIVED here from the signals, every render. It is never a column.
 */
export default async function PublicWorksPage({ searchParams }: { searchParams: Promise<{ county?: string; tier?: string }> }) {
  const { company, ...user } = await requireCompanyContext();
  if (!company.isProvaOperator || user.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <PageHeader route="/sales/public-works" title="Not part of your access" />
        <p className="text-sm text-ink-body">Nothing here for this account.</p>
      </PageShell>
    );
  }

  const params = await searchParams;
  const county = (COUNTIES as readonly string[]).includes(params.county ?? "") ? params.county! : null;
  const tierFilter: Tier | null = params.tier === "1" ? 1 : params.tier === "2" ? 2 : params.tier === "3" ? 3 : null;
  const today = new Date(`${await viewerToday()}T00:00:00Z`);

  const [firms, slices, letterCounts] = await Promise.all([
    prisma.publicWorksFirm.findMany({
      where: county ? { county } : undefined,
      select: {
        licence: true, name: true, phone: true, city: true, county: true, classes: true, hasEmployees: true, owners: true,
        signals: { select: { kind: true, project: true, awardingBody: true, primeContractor: true, occurredOn: true } },
        letters: { select: { status: true, signalFact: true }, orderBy: { queuedAt: "desc" }, take: 1 },
      },
    }),
    prisma.publicWorksSyncSlice.findMany({ orderBy: { syncedAt: "desc" } }),
    prisma.publicWorksLetter.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const letters = { queued: 0, sent: 0, failed: 0 };
  for (const g of letterCounts) {
    if (g.status === "QUEUED") letters.queued = g._count._all;
    if (g.status === "SENT") letters.sent = g._count._all;
    if (g.status === "FAILED") letters.failed = g._count._all;
  }
  const missing = missingConfig(configFromEnv());
  const configProblem = missing.length ? `No return address: set OUTBOUND_FROM_NAME, OUTBOUND_FROM_LINE1, OUTBOUND_FROM_CITY, OUTBOUND_FROM_ZIP, OUTBOUND_MOBILE and OUTBOUND_REPLY_EMAIL before queueing (${missing.length} unset).` : null;

  const rows = firms
    .map((f) => {
      const signals: Signal[] = f.signals;
      const owners = Array.isArray(f.owners) ? (f.owners as Array<{ name?: string }>) : [];
      return { ...f, tier: tierFor(signals, today), fact: factFor(signals), filings: signals.filter((s) => s.kind === "ECPR_FILING").length, owner: owners[0]?.name ?? "" };
    })
    .filter((r) => (tierFilter ? r.tier === tierFilter : r.tier <= 2))
    .sort((a, b) => a.tier - b.tier || b.filings - a.filings || Number(b.hasEmployees) - Number(a.hasEmployees) || a.name.localeCompare(b.name));

  const counts = { 1: 0, 2: 0, 3: 0 } as Record<Tier, number>;
  for (const f of firms) counts[tierFor(f.signals, today)]++;
  const lastSync = slices[0]?.syncedAt ?? null;

  return (
    <PageShell width="working">
      <PageHeader
        route="/sales/public-works"
        title="Public works market"
        subtitle="Every CLEAR-licensed drywall, plaster, framing and insulation firm in California, and what DIR says each one is doing on public works. The fact column is the opener."
      />

      <section className="mb-6 rounded-xl border border-line-card bg-surface p-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-body">
          <span><strong className="text-ink">{firms.length}</strong> firms{county ? ` in ${county} County` : ""}</span>
          <span><strong className="text-ink">{counts[1]}</strong> in market this week</span>
          <span><strong className="text-ink">{counts[2]}</strong> on the public-works record</span>
          <span><strong className="text-ink">{counts[3]}</strong> with no public signal</span>
          <span className="text-xs text-ink-muted">
            {lastSync ? `Last pull ${lastSync.toISOString().slice(0, 16).replace("T", " ")} UTC · ${slices.length} of ${COUNTIES.length + 3} slices pulled` : "Nothing pulled yet."}
          </span>
        </div>
        <PublicWorksSyncButton />
      </section>

      <PublicWorksLettersStrip counts={letters} keyMode={keyMode(process.env.LOB_API_KEY)} configProblem={configProblem} />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-xs text-ink-muted">
          County
          <select name="county" defaultValue={county ?? ""} className="ml-2 rounded-lg border border-line-card bg-surface px-2 py-1 text-sm text-ink">
            <option value="">All of California</option>
            {COUNTIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          Tier
          <select name="tier" defaultValue={tierFilter ? String(tierFilter) : ""} className="ml-2 rounded-lg border border-line-card bg-surface px-2 py-1 text-sm text-ink">
            <option value="">In market or on record (1–2)</option>
            <option value="1">1 — in market this week</option>
            <option value="2">2 — on the record</option>
            <option value="3">3 — no public signal</option>
          </select>
        </label>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-body">
          {firms.length === 0 ? "No firms yet. Press the button above: the first pull reads CSLB's licence file." : "No firms match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line-card bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Firm</th>
                <th className="px-3 py-2">Owner / RMO</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">Trade</th>
                <th className="px-3 py-2">The fact to open with</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-row">
              {rows.map((r) => (
                <tr key={r.licence} className="align-top">
                  <td className="px-3 py-2 text-ink-muted">{r.tier}</td>
                  <td className="px-3 py-2 text-ink">
                    {r.name}
                    {!r.hasEmployees && <span className="ml-1 text-xs text-ink-muted">(no employees)</span>}
                    <span className="block text-xs text-ink-muted">CSLB {r.licence}{r.filings ? ` · ${r.filings} filings` : ""}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-body">{r.owner}</td>
                  <td className="px-3 py-2 text-ink-body">{r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{r.phone}</a> : "—"}</td>
                  <td className="px-3 py-2 text-ink-body">{r.city ? r.city.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase()) : "—"}</td>
                  <td className="px-3 py-2 text-ink-body">{r.classes.join("/")}</td>
                  <td className="px-3 py-2 text-ink-body">
                    {r.fact || "—"}
                    {r.fact && <PreviewLetterDisclosure licence={r.licence} letterStatus={r.letters[0]?.signalFact === r.fact ? r.letters[0].status : null} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">
        <Link href="/sales" className="hover:underline">Back to the sales CRM</Link>. A firm with no employees holds an Exempt licence: no payroll, so no certified payroll to build.
      </p>
    </PageShell>
  );
}
