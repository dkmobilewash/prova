// The monthly fringe remittance as the document that goes in the
// envelope, rather than as a screen about what is owed.
//
// The sibling page (../) stays exactly as it is, and the split is the
// same one /jobs/[id]/certified-payroll and its wh-347 child already
// make. That one is the WORKING view: what this company owes the funds
// this month, next to the apprentice ratio and the rate schedules behind
// both. This one is the FILING view: one sheet per hall, employer header,
// members named, four funds broken out, signature block. Two audiences,
// two documents.
//
// ONE DOCUMENT PER LOCAL, and that is structural rather than cosmetic.
// Each hall gets its own report and its own cheque; a combined sheet
// cannot be sent to either of them, so nothing on this page ever sums
// across locals — there is deliberately no grand total anywhere below,
// and every sheet starts on a fresh printed page. `?local=<id>` prints
// exactly one of them.
//
// It refuses to look finished, for the same reason the WH-347 does. A
// blank on a remittance is indistinguishable from a zero, and a zero on a
// remittance is a statement to a trust fund that nothing is owed — for
// that fund, or for that person. So every field cstream cannot source is
// printed IN PLACE in red as a sentence, each sheet carries a banner
// naming all of them, and the banner is ON THE SHEET rather than only in
// the app chrome, because the chrome does not print and the sheet is what
// leaves the building. See lib/fringe-remittance-filing.ts.
//
// And it refuses outright rather than printing arithmetic that does not
// add up: remittanceReconciliationErrors() runs before any money is
// rendered, and anything it returns replaces the sheets. A fund's clerk
// checks whether the lines total the cheque before looking at anything
// else, so a document whose own lines disagree is worse than no document.

import { Fragment } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { loadRemittance, monthBounds } from "@/lib/union-compliance-query";
import {
  isWhollyUnpriced,
  remittanceReconciliationErrors,
  type RemittanceLocalRow,
} from "@/lib/fringe-remittance";
import {
  REMITTANCE_BLOCKING_FIELD_REASON,
  employerAddressLines,
  remittanceBlockingFields,
  type RemittanceFilingCompany,
} from "@/lib/fringe-remittance-filing";

/** What goes where a value should have been. A sentence or a short phrase
 * in red, never a dash — the reader has to learn what to do about it.
 * Same call lib/worker-name.ts makes with "Name not recorded". */
function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-medium leading-tight text-red-600">{children}</span>;
}

/** Hours as a remittance prints them — 8, 7.5, never 8.00. */
function hoursCell(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** The four funds, in the order they are printed and cheque-written. Each
 * one is a separate line and a separate cheque, which is the whole reason
 * lib/fringe-remittance.ts breaks them out instead of publishing one
 * "fringe" number. */
const FUNDS = [
  { key: "pension", label: "Pension" },
  { key: "vacation", label: "Vacation" },
  { key: "healthWelfare", label: "Health & welfare" },
  { key: "training", label: "Training" },
] as const;

export default async function FringeRemittanceDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; local?: string }>;
}) {
  // The same capability as the page this prints from. This sheet shows
  // strictly less than /union-compliance does — no rate schedules, no
  // apprentice ratio, no setup — so anything else here would be an
  // inconsistency rather than a tightening.
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company } = context;

  const { month: monthParam, local: localParam } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? (monthParam as string)
    : new Date().toISOString().slice(0, 7);
  const { start, end } = monthBounds(month);

  const report = await loadRemittance(company.id, month);

  // Before a single figure is rendered. The arithmetic is guaranteed by
  // construction inside allocateToCents; this is the check that the
  // guarantee is still wired up, and the document is refused rather than
  // printed if it is not.
  const reconciliation = remittanceReconciliationErrors(report);

  const filingCompany: RemittanceFilingCompany = {
    name: company.name,
    dbaName: company.dbaName,
    hqAddressLine1: company.hqAddressLine1,
    hqAddressLine2: company.hqAddressLine2,
    hqCity: company.hqCity,
    hqState: company.hqState,
    hqZip: company.hqZip,
    ein: company.ein,
  };
  const addressLines = employerAddressLines(filingCompany);

  const sheets = localParam
    ? report.locals.filter((local) => local.unionLocalId === localParam)
    : report.locals;

  const previousMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  })();
  const nextMonth = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  })();
  const href = (targetMonth: string, targetLocal?: string) =>
    `/union-compliance/remittance?month=${targetMonth}${targetLocal ? `&local=${targetLocal}` : ""}`;

  /** One hall's sheet. Self-contained on purpose: everything a fund needs
   * to act on this report is on this piece of paper, because this piece of
   * paper is what it receives. */
  const Sheet = ({ local, first }: { local: RemittanceLocalRow; first: boolean }) => {
    const blocking = remittanceBlockingFields(filingCompany, local);
    const localBlank = isWhollyUnpriced(local);

    return (
      <article
        className={`mt-6 border border-slate-300 bg-white p-6 text-black print:mt-0 print:border-0 print:p-0 ${
          first ? "" : "print:break-before-page"
        }`}
      >
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            Fringe benefit remittance report
          </p>
          <p className="text-lg font-bold">{local.unionLocalLabel}</p>
          <p className="text-[10px]">
            Reporting period {start} through {end} · one report and one remittance per local
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-y border-black py-2 text-[11px]">
          <div>
            <span className="font-semibold">Employer: </span>
            {company.name}
            {company.dbaName ? ` (dba ${company.dbaName})` : ""}
          </div>
          <div>
            <span className="font-semibold">EIN: </span>
            {company.ein?.trim() ? (
              company.ein
            ) : (
              <Missing>
                Not recorded on the company record. An owner records it at Settings → Company.
              </Missing>
            )}
          </div>
          <div>
            <span className="font-semibold">Address: </span>
            {addressLines ? (
              addressLines.join(" · ")
            ) : (
              <Missing>
                No complete address on the company record — a fund matches a report to an employer
                by name and address. An owner records it at Settings → Company.
              </Missing>
            )}
          </div>
          <div>
            <span className="font-semibold">Employer / account no. with this fund: </span>
            <Missing>
              Each fund issues its own employer number and cstream records none. Copy it from last
              month&apos;s report.
            </Missing>
          </div>
          <div>
            <span className="font-semibold">Remit report and payment to: </span>
            <Missing>
              cstream records no fund addresses. Each fund&apos;s report and cheque go to that
              fund&apos;s own administrator, not to the hall.
            </Missing>
          </div>
          <div>
            <span className="font-semibold">Total remitted this period: </span>
            {localBlank ? (
              <Missing>
                None of this local&apos;s hours could be priced, so no amount is stated. Nothing
                owed and nothing computed are different claims.
              </Missing>
            ) : (
              <span className="font-semibold">{money(local.total)}</span>
            )}
            {!localBlank && local.uncomputedHours > 0 && (
              <>
                {" "}
                <Missing>
                  Short by whatever {hoursCell(local.uncomputedHours)} unpriced hours are worth.
                </Missing>
              </>
            )}
          </div>
        </div>

        {/* One cheque per fund, so the amounts are stated per fund before
            anything is broken down by person. This is the figure the
            office manager writes cheques from. */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left">Fund (separate remittance)</th>
              <th className="border border-black px-2 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {FUNDS.map((fund) => (
              <tr key={fund.key}>
                <td className="border border-black px-2 py-1">{fund.label}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">
                  {localBlank ? (
                    <Missing>Unpriced</Missing>
                  ) : (
                    money(local.components[fund.key])
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td className="border border-black px-2 py-1 font-semibold">
                Total, all funds, {hoursCell(local.hours)} hours
              </td>
              <td className="border border-black px-2 py-1 text-right font-semibold tabular-nums">
                {localBlank ? <Missing>Unpriced</Missing> : money(local.total)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* The half that makes this fileable at all. A fund credits hours
            to an INDIVIDUAL member's account — vesting and health &
            welfare eligibility both turn on how many hours one person
            worked in the period — so a classification rollup gives it the
            money and nobody to credit. */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="border border-black px-1 py-1 text-left">Member</th>
                <th className="border border-black px-1 py-1 text-left">Member no.</th>
                <th className="border border-black px-1 py-1 text-right">Hours</th>
                {FUNDS.map((fund) => (
                  <th key={fund.key} className="border border-black px-1 py-1 text-right">
                    {fund.label}
                  </th>
                ))}
                <th className="border border-black px-1 py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {local.crafts.map((craft) => {
                const craftBlank = isWhollyUnpriced(craft);
                return (
                  <Fragment key={craft.craftClassificationId}>
                    <tr>
                      <td
                        colSpan={3 + FUNDS.length + 1}
                        className="border border-black bg-slate-100 px-1 py-1 font-semibold"
                      >
                        {craft.craftLabel}
                        {craft.uncomputedHours > 0 && (
                          <>
                            {" · "}
                            <Missing>
                              {hoursCell(craft.uncomputedHours)} of these hours have no rate
                              schedule in force on the day they were worked.
                            </Missing>
                          </>
                        )}
                      </td>
                    </tr>

                    {craft.employees.map((employee) => {
                      const blank = isWhollyUnpriced(employee);
                      return (
                        <tr key={`${craft.craftClassificationId}-${employee.employeeUserId}`}>
                          <td className="border border-black px-1 py-1">
                            {employee.nameMissing ? (
                              <Missing>
                                {employee.employeeName} — a fund cannot credit hours to a
                                placeholder. Add a name on the Team page.
                              </Missing>
                            ) : (
                              employee.employeeName
                            )}
                          </td>
                          <td className="border border-black px-1 py-1">
                            <Missing>Not recorded</Missing>
                          </td>
                          <td className="border border-black px-1 py-1 text-right tabular-nums">
                            {hoursCell(employee.hours)}
                          </td>
                          {FUNDS.map((fund) => (
                            <td
                              key={fund.key}
                              className="border border-black px-1 py-1 text-right tabular-nums"
                            >
                              {blank ? (
                                <Missing>Unpriced</Missing>
                              ) : (
                                money(employee.components[fund.key])
                              )}
                            </td>
                          ))}
                          <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
                            {blank ? <Missing>Unpriced</Missing> : money(employee.total)}
                          </td>
                        </tr>
                      );
                    })}

                    <tr>
                      <td className="border border-black px-1 py-1 text-right font-semibold" colSpan={2}>
                        {craft.craftLabel} subtotal
                      </td>
                      <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
                        {hoursCell(craft.hours)}
                      </td>
                      {FUNDS.map((fund) => (
                        <td
                          key={fund.key}
                          className="border border-black px-1 py-1 text-right font-semibold tabular-nums"
                        >
                          {craftBlank ? (
                            <Missing>Unpriced</Missing>
                          ) : (
                            money(craft.components[fund.key])
                          )}
                        </td>
                      ))}
                      <td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
                        {craftBlank ? <Missing>Unpriced</Missing> : money(craft.total)}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}

              <tr>
                <td className="border border-black px-1 py-1 text-right font-bold" colSpan={2}>
                  {local.unionLocalLabel} — total remitted
                </td>
                <td className="border border-black px-1 py-1 text-right font-bold tabular-nums">
                  {hoursCell(local.hours)}
                </td>
                {FUNDS.map((fund) => (
                  <td
                    key={fund.key}
                    className="border border-black px-1 py-1 text-right font-bold tabular-nums"
                  >
                    {localBlank ? <Missing>Unpriced</Missing> : money(local.components[fund.key])}
                  </td>
                ))}
                <td className="border border-black px-1 py-1 text-right font-bold tabular-nums">
                  {localBlank ? <Missing>Unpriced</Missing> : money(local.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* The banner lives ON THE SHEET, not only in the app chrome. The
            chrome does not print, and this is the piece of paper somebody
            signs. */}
        <div className="mt-5 border-2 border-red-600 p-3">
          <p className="text-[11px] font-bold uppercase text-red-600">
            Not ready to send — {blocking.length}{" "}
            {blocking.length === 1 ? "field is" : "fields are"} missing
          </p>
          <p className="mt-1 text-[10px] text-black">
            The hours and the money above are computed from the hours actually logged. What follows
            is every field a remittance carries that cstream cannot fill in.
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
            {blocking.map((field) => (
              <li key={field} className="text-[10px] leading-snug text-red-600">
                {REMITTANCE_BLOCKING_FIELD_REASON[field]}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 text-[10px]">
          <div className="border-t border-black pt-1">Authorized signature</div>
          <div className="border-t border-black pt-1">Date signed</div>
          <div className="border-t border-black pt-1">Printed name and title</div>
          <div className="border-t border-black pt-1">Telephone</div>
        </div>
        <p className="mt-2 text-[10px] text-black">
          Signed by hand. cstream does not sign anything on your behalf, and the date on a filing is
          the date it was signed rather than the date it was printed.
        </p>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 print:px-0 print:py-0">
      <div className="print:hidden">
        <Link href={`/union-compliance?month=${month}`} className="text-sm text-link hover:underline">
          ← Union fringe &amp; apprenticeship for this month
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Fringe remittance</h1>
            <p className="mt-1 text-sm text-ink-body">
              One report per local, {start} through {end}. Each hall gets its own sheet and its own
              cheque, so nothing here is totalled across halls.
            </p>
          </div>
          <PrintButton />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href={href(previousMonth, localParam)} className="text-sm text-link">
            ← {previousMonth}
          </Link>
          <span className="text-sm text-ink-label">{month}</span>
          <Link href={href(nextMonth, localParam)} className="text-sm text-link">
            {nextMonth} →
          </Link>
          {localParam && (
            <Link href={href(month)} className="text-sm text-link">
              Show every local
            </Link>
          )}
        </div>

        {reconciliation.length === 0 && report.locals.length > 1 && !localParam && (
          <p className="mt-4 text-xs text-ink-muted">
            Printing now produces {report.locals.length} sheets, one per local, each starting on its
            own page. To print just one, open it on its own:{" "}
            {report.locals.map((local, index) => (
              <span key={local.unionLocalId}>
                {index > 0 && " · "}
                <Link href={href(month, local.unionLocalId)} className="text-link">
                  {local.unionLocalLabel}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </div>

      {reconciliation.length > 0 ? (
        // The refusal. No sheet is rendered at all — printing a remittance
        // whose lines disagree with its own total is the one thing a
        // fund's clerk checks before looking at the money.
        <div className="mt-6 rounded-lg border border-red-300 bg-tag-rose p-4">
          <p className="text-sm font-semibold text-tag-rose-ink">
            This report will not print. Its member lines do not add up to the classification totals
            above them.
          </p>
          <p className="mt-1 text-xs text-tag-rose-ink/80">
            That is a bug in cstream, not something you can fix from this page. Send these lines to
            support; the figures themselves are withheld rather than shown, because a remittance
            that does not reconcile is worse than no remittance.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {reconciliation.map((error) => (
              <li key={error} className="font-mono text-xs leading-snug text-tag-rose-ink">
                {error}
              </li>
            ))}
          </ul>
        </div>
      ) : sheets.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">
            {localParam
              ? "That local has no hours in this month, so there is no report to file for it."
              : "No hours were logged this month against a craft classification, so there is nothing to remit."}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            A hall you are signatory to may still expect a report saying so — check the agreement
            before assuming silence is acceptable.
          </p>
        </div>
      ) : (
        sheets.map((local, index) => (
          <Sheet key={local.unionLocalId} local={local} first={index === 0} />
        ))
      )}
    </div>
  );
}
