import Link from "next/link";
import { PageShell } from "@prova/ui";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  CALL_LIST_CLASSES,
  CALL_LIST_CLASS_LABEL,
  loadCallList,
  type CallListClass,
} from "@/lib/cslb/callList";
import { AddCslbLeadButton } from "@/components/AddCslbLeadButton";

/**
 * THE CALL LIST — every California firm in our trades, in good standing, with
 * a phone and the person to ask for, filtered down to the morning's dialing.
 *
 * Derived from the two CSLB files (see `lib/cslb/callList.ts` for why it is
 * not seven thousand leads) and cached for a day. The first visit of the day
 * streams ~163 MB and can take half a minute, which is why `maxDuration` is
 * 60 here and the page says so; every later visit is instant.
 *
 * A row becomes a `SalesLead` only when the caller presses "Add as lead" —
 * that is the moment "a firm in a government file" becomes "a company we are
 * working", and it is a person's decision, not an import's.
 */
export const maxDuration = 60;

const PAGE_SIZE = 150;

type SearchParams = { class?: string; county?: string; q?: string };

function isClass(value: string | undefined): value is CallListClass {
  return (CALL_LIST_CLASSES as readonly string[]).includes(value ?? "");
}

export default async function CallListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  if (!company.isProvaOperator) {
    return (
      <PageShell width="reading">
        <h1 className="mb-2 text-xl font-semibold text-ink">Not part of your access</h1>
        <p className="text-sm text-ink-body">Nothing here for this account.</p>
      </PageShell>
    );
  }
  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <h1 className="mb-2 text-xl font-semibold text-ink">Owner only</h1>
        <p className="text-sm text-ink-body">The sales CRM is restricted to the account owner.</p>
      </PageShell>
    );
  }

  const params = await searchParams;
  const classFilter = isClass(params.class) ? params.class : null;
  const countyFilter = (params.county ?? "").trim() || null;
  const query = (params.q ?? "").trim().toLowerCase() || null;

  const list = await loadCallList();

  const filtered = list.rows.filter(
    (row) =>
      (classFilter === null || row.classes.includes(classFilter)) &&
      (countyFilter === null || row.county === countyFilter) &&
      (query === null ||
        row.name.toLowerCase().includes(query) ||
        (row.owner ?? "").toLowerCase().includes(query) ||
        (row.city ?? "").toLowerCase().includes(query)),
  );
  const shown = filtered.slice(0, PAGE_SIZE);

  /* Which of the shown firms are already leads, by licence — so the row says
     "open" rather than offering to add a second copy. One query, scoped to the
     rows on screen. */
  const existing = await prisma.salesLead.findMany({
    where: { companyId: company.id, licenceNumber: { in: shown.map((row) => row.licence) } },
    select: { id: true, licenceNumber: true },
  });
  const leadByLicence = new Map(existing.map((lead) => [lead.licenceNumber, lead.id]));

  const t = list.totals;
  const spanishShare = t.withOwner > 0 ? Math.round((100 * t.spanishSurnames) / t.withOwner) : null;

  return (
    // A list of firms to dial, each a name, a person, a phone and a place:
    // `working`, because the question is how many you can see at once.
    <PageShell width="working">
      <p className="mb-2 text-xs text-ink-muted">
        <Link href="/sales" className="hover:underline">← Sales CRM</Link>
      </p>
      <h1 className="mb-1 text-lg font-semibold text-ink">Call list</h1>
      <p className="mb-4 text-sm text-ink-body">
        Every California firm licensed in our four trades, in good standing, with a phone on file —
        and the person to ask for, where CSLB names one. Built from CSLB&rsquo;s public licence and
        personnel files; refreshed once a day (this copy{" "}
        {new Date(list.builtAtMs).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT).
      </p>

      <dl className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-line-card bg-surface p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-muted">Callable firms</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">{t.firms.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">With a named owner</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">{t.withOwner.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Common Spanish surname</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">
            {spanishShare === null ? "—" : `${spanishShare}%`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Counties</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">{t.counties.length}</dd>
        </div>
      </dl>
      <p className="mb-6 text-xs text-ink-muted">
        By class:{" "}
        {CALL_LIST_CLASSES.map((c) => `${CALL_LIST_CLASS_LABEL[c]} ${t.byClass[c].toLocaleString()}`).join(" · ")}.
        The surname share is a rough prior from the sixty most common Hispanic surnames, taken over
        the named owner — a reason to offer Spanish in the first sentence, not a fact about anyone.
      </p>

      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Trade
          <select name="class" defaultValue={classFilter ?? ""} className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body">
            <option value="">All four</option>
            {CALL_LIST_CLASSES.map((c) => (
              <option key={c} value={c}>{CALL_LIST_CLASS_LABEL[c]} ({c})</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          County
          <select name="county" defaultValue={countyFilter ?? ""} className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body">
            <option value="">All</option>
            {t.counties.map((county) => (
              <option key={county} value={county}>{county}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Name, owner or city
          <input name="q" defaultValue={query ?? ""} className="rounded-md border border-line-card bg-surface px-2 py-1 text-sm text-ink-body" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-yellow-500">
            Filter
          </button>
        </div>
      </form>

      <p className="mb-2 text-xs text-ink-muted">
        {filtered.length.toLocaleString()} firm{filtered.length === 1 ? "" : "s"} match
        {filtered.length > PAGE_SIZE ? ` — showing the first ${PAGE_SIZE}; narrow by county to see the rest` : ""}.
      </p>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-body">Nothing matches. Clear a filter.</p>
      ) : (
        <ul className="divide-y divide-line-row border-y border-line-row">
          {shown.map((row) => {
            const leadId = leadByLicence.get(row.licence);
            return (
              <li key={row.licence} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {row.name}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {row.classes.join(" · ")} · lic. {row.licence}
                    </span>
                  </p>
                  <p className="text-xs text-ink-body">
                    {row.owner ? (
                      <>
                        Ask for <span className="font-medium">{row.owner}</span>
                        {row.ownerTitle ? ` (${row.ownerTitle})` : ""} ·{" "}
                      </>
                    ) : (
                      <span className="text-ink-muted">No current principal on file · </span>
                    )}
                    <a href={`tel:${row.phone.replace(/\D/g, "")}`} className="tabular-nums hover:underline">{row.phone}</a>
                    {" · "}
                    {[row.city, row.county ? `${row.county} County` : null].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="shrink-0">
                  {leadId ? (
                    <Link href={`/sales/${leadId}`} className="text-sm text-ink-label hover:underline">
                      Open lead →
                    </Link>
                  ) : (
                    <AddCslbLeadButton licence={row.licence} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
