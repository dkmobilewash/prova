import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { G702DownloadButton } from "@/components/G702DownloadButton";
import { money } from "@/lib/money";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { loadPayApplication } from "@/lib/pay-application-query";
import { formatPercent, g702Document, G702_LINES, party } from "@/lib/billing/g702";

/** A header field as the form prints it: label, then the value or a blank
 * to be written on. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-row py-1">
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-sm text-ink">{value ?? " "}</span>
    </div>
  );
}

/** A blank, labelled line in a signature or notary block. Fields only — the
 * certification and notary wording belongs to whatever form the GC
 * requires, and this app does not write legal text. */
function Blank({ label }: { label: string }) {
  return (
    <div className="flex items-end gap-2 text-xs text-ink-muted">
      <span className="shrink-0">{label}</span>
      <span className="mb-0.5 h-px w-full border-b border-line-row" />
    </div>
  );
}

export default async function PayApplicationPage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  // The job page withholds its billing SECTIONS from anyone without
  // MANAGE_BILLING; this is the same document on its own URL, so it has
  // to answer the same way or the withholding upstairs means nothing.
  const { context, allowed } = await requireCapability("MANAGE_BILLING");
  if (!allowed) return <NoAccess capability="MANAGE_BILLING" />;
  const { company } = context;

  const view = await loadPayApplication(id, invoiceId, company.id);
  if (!view) {
    notFound();
  }
  const { job, invoice, isPayApplication, lineItems: lineItemResults, summary } = view;
  // `issuedAt` is when the invoice was actually issued, not a date someone
  // typed, so it renders where the reader is standing. `periodTo` and the
  // contract date are ENTERED calendar days and render in UTC.
  const timeZone = await viewerTimeZone();

  // ONE object for the screen and the PDF. The page below reads its labels
  // and figures from this, and the download button is handed the same
  // object, so what is on screen and what is in the file cannot differ.
  const doc = g702Document({
    header: {
      project: job.name,
      projectLocation: job.projectLocation ?? job.siteAddress ?? null,
      to: party(job.contact.name, job.contact.address),
      from: party(
        company.dbaName ? `${company.name} (dba ${company.dbaName})` : company.name,
        company.hqAddressLine1,
        company.hqAddressLine2,
        [company.hqCity, company.hqState, company.hqZip].filter(Boolean).join(" ").replace(/^(\S.*) (\S+) (\S+)$/, "$1, $2 $3") || null,
        company.phone,
      ),
      contractFor: job.scope ?? null,
      applicationNumber: invoice.number,
      applicationDate: formatInstant(invoice.issuedAt, timeZone),
      periodTo: invoice.periodTo ? formatCalendarDate(invoice.periodTo) : null,
      contractDate: view.contractDate ? formatCalendarDate(view.contractDate) : null,
      projectNumber: job.contractNumber ?? null,
    },
    lineItems: lineItemResults,
    summary,
    netChangeByChangeOrders: view.netChangeByChangeOrders,
  });
  const { header, lines, continuation } = doc;

  return (
    // PRINTED OUTPUT: on screen the page wears the shared header; on paper it
    // prints the heading below, and the shell drops its gutters and measure.
    <PageShell width="working" className="print:max-w-none print:p-0">
      <div className="print:hidden">
        <PageHeader
          route="/dashboard"
          parent={[
            { href: `/jobs/${job.id}`, label: job.name },
            { href: `/jobs/${job.id}/billing`, label: "Billing" },
          ]}
          title={`Application for payment #${invoice.number}`}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              {isPayApplication && <G702DownloadButton document={doc} />}
              <PrintButton />
            </span>
          }
        />
      </div>
      <h1 className="hidden text-xl font-semibold text-ink print:block">
        Application and certificate for payment #{invoice.number} — {job.name}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {job.contact.name}
        {invoice.description ? ` · ${invoice.description}` : ""}
      </p>
      <p className="mt-3 max-w-2xl text-xs text-ink-muted">
        Laid out to follow AIA Documents G702 and G703 — the summary, the continuation sheet with columns A–I, and
        blank certification and notary fields. It is not an AIA form; the figures come from this job&rsquo;s schedule of
        values.
      </p>

      {!isPayApplication ? (
        <p className="mt-8 text-sm text-ink-muted">
          This invoice wasn&rsquo;t submitted as a pay application — it was created as a simple lump-sum bill, so
          there&rsquo;s no per-line-item breakdown to show. Submit a pay application from the job page to get a
          continuation sheet like this one.
        </p>
      ) : (
        <>
          {/* ── G702 header: parties left, application fields right ── */}
          <div className="mt-6 grid gap-x-8 gap-y-4 rounded-lg border border-line-card bg-surface p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">To (GC / owner)</p>
                <p className="text-ink">{header.to.name}</p>
                {header.to.lines.map((line) => (
                  <p key={line} className="text-ink-body">
                    {line}
                  </p>
                ))}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">From (contractor)</p>
                <p className="text-ink">{header.from.name}</p>
                {header.from.lines.map((line) => (
                  <p key={line} className="text-ink-body">
                    {line}
                  </p>
                ))}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Project</p>
                <p className="text-ink">{header.project}</p>
                {header.projectLocation && <p className="text-ink-body">{header.projectLocation}</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Contract for</p>
                <p className="text-ink">{header.contractFor ?? " "}</p>
              </div>
            </div>
            <div className="flex flex-col">
              <Field label="Application no." value={String(header.applicationNumber)} />
              <Field label="Period to" value={header.periodTo} />
              <Field label="Application date" value={header.applicationDate} />
              <Field label="Project / contract no." value={header.projectNumber} />
              <Field label="Contract date" value={header.contractDate} />
              {!header.periodTo && (
                <p className="mt-2 text-xs text-warn print:hidden">
                  No period-to date on this application — it predates the field. Write the period ending date on
                  the sheet before it goes out; new applications ask for it on the form.
                </p>
              )}
            </div>
          </div>

          {/* ── The nine lines. Each label is its own <p> with the figure in
              the next <p>: the e2e rehearsal reads them that way, and a
              screen reader gets label-then-value in order. ── */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="rounded-lg border border-line-card bg-surface p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-label">
                Contractor&rsquo;s application for payment
              </p>
              <div className="flex flex-col divide-y divide-line-row text-sm">
                {G702_LINES.map((line) => (
                  <div key={line.key}>
                    <div className="grid grid-cols-[1.5rem_1fr_auto] items-baseline gap-2 py-1.5">
                      <span className="text-xs text-ink-muted">{line.number}.</span>
                      <p className="text-ink-body">{line.label}</p>
                      <p
                        className={`text-right tabular-nums ${
                          line.key === "currentPaymentDue" ? "font-medium text-ok" : "text-ink"
                        }`}
                      >
                        {money(lines[line.key])}
                      </p>
                    </div>
                    {line.key === "retainageToDate" && (
                      <div className="ml-6 flex flex-col gap-1 pb-2">
                        <Blank label="a. ____ % of completed work" />
                        <Blank label="b. ____ % of stored material" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-line-card bg-surface p-4 text-xs">
                <p className="mb-2 font-semibold uppercase tracking-wide text-ink-label">Change order summary</p>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-ink-muted">
                  <span />
                  <span className="text-right">Additions</span>
                  <span className="text-right">Deductions</span>
                  {["Approved in previous months", "Approved this month", "Totals"].map((label) => (
                    <div key={label} className="contents">
                      <span>{label}</span>
                      <span className="w-20 border-b border-line-row" />
                      <span className="w-20 border-b border-line-row" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-baseline justify-between border-t border-line-row pt-2">
                  <span className="text-ink-body">Net changes by change order</span>
                  <span className="tabular-nums text-ink">{money(lines.netChangeByChangeOrders)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-line-card bg-surface p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Contractor&rsquo;s certification
                </p>
                <p className="mb-3 text-xs text-ink-muted">
                  Certification and notary wording is left to the form your GC requires; this sheet fills in the
                  figures only.
                </p>
                <div className="flex flex-col gap-2">
                  <Blank label="Contractor:" />
                  <Blank label="By (signature):" />
                  <Blank label="Name and title:" />
                  <Blank label="Date:" />
                  <Blank label="State of:" />
                  <Blank label="County of:" />
                  <Blank label="Subscribed and sworn to before me this ____ day of ____________," />
                  <Blank label="Notary public:" />
                  <Blank label="My commission expires:" />
                </div>
              </div>

              <div className="rounded-lg border border-line-card bg-surface p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Architect&rsquo;s / GC&rsquo;s certificate for payment
                </p>
                <div className="flex flex-col gap-2">
                  <Blank label="Amount certified: $" />
                  <Blank label="Architect / GC:" />
                  <Blank label="By (signature):" />
                  <Blank label="Name and title:" />
                  <Blank label="Date:" />
                </div>
              </div>
            </div>
          </div>

          {/* ── G703 continuation sheet, columns A–I ── */}
          <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-ink-label">Continuation sheet</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-muted">
                  <th className="pb-1 pr-3 font-normal">
                    <span className="block text-ink-label">A</span>Item no.
                  </th>
                  <th className="pb-1 pr-3 font-normal">
                    <span className="block text-ink-label">B</span>Description of work
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">C</span>Scheduled value
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">D</span>From previous application
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">E</span>This period
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">F</span>Materials presently stored (not in D or E)
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">G</span>Total completed and stored to date (D+E+F)
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">%</span>(G ÷ C)
                  </th>
                  <th className="pb-1 pr-3 text-right font-normal">
                    <span className="block text-ink-label">H</span>Balance to finish (C − G)
                  </th>
                  <th className="pb-1 text-right font-normal">
                    <span className="block text-ink-label">I</span>Retainage (if variable rate)
                  </th>
                </tr>
              </thead>
              <tbody>
                {continuation.rows.map((row) => (
                  <tr key={row.itemNo} className="border-t border-line-row">
                    <td className="py-1 pr-3 text-ink-muted">{row.itemNo}</td>
                    <td className="py-1 pr-3 text-ink-label">{row.description}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-body">{money(row.scheduledValue)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-body">{money(row.fromPrevious)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink">{money(row.thisPeriod)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-body">{money(row.materialsStored)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink">{money(row.totalCompletedAndStored)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-body">{formatPercent(row.percent) || "—"}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-ink-body">{money(row.balanceToFinish)}</td>
                    <td className="py-1 text-right text-ink-muted">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-card font-medium">
                  <td className="py-1.5 pr-3" />
                  <td className="py-1.5 pr-3 text-ink-label">Grand totals</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(continuation.totals.scheduledValue)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(continuation.totals.fromPrevious)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(continuation.totals.thisPeriod)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(continuation.totals.materialsStored)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                    {money(continuation.totals.totalCompletedAndStored)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{formatPercent(continuation.totals.percent) || "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(continuation.totals.balanceToFinish)}</td>
                  <td className="py-1.5" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 max-w-2xl text-xs text-ink-muted">
            Column I is blank because retainage on this job is withheld per application, not per line; line 5 above
            carries the total. Lines 5a and 5b are left for you to fill in if this GC wants the split.
          </p>
        </>
      )}
    </PageShell>
  );
}
