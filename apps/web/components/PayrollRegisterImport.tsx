"use client";

import { useMemo, useState, useTransition } from "react";
import { importPayrollRegister } from "@/lib/actions";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, TOO_LARGE_MESSAGE, importTooLarge } from "@/lib/spreadsheet-import";
import {
  REGISTER_FIELD_LIST,
  planPayrollRegisterImport,
  type ExistingRegisterEntry,
  type RegisterCrew,
  type RegisterField,
  type RegisterOverrides,
} from "@/lib/payroll-register-import";
import { ExistingList, Problems } from "@/components/SpreadsheetImport";

/**
 * Paste or upload a weekly payroll register (Gusto, ADP RUN, Sage 100
 * Contractor, Foundation, or any export with column headers) and see the
 * plan before anything is saved.
 *
 * Same arrangement as SpreadsheetImport and MyCoiImport: the parse here is
 * for DISPLAY ONLY. Confirm sends the raw text and the column-mapping
 * overrides, and the server re-plans against a fresh read inside the
 * transaction that writes — see lib/actions/payrollRegister.ts.
 *
 * ONE THING THIS FORM DOES NOT HAVE THAT ITS SIBLINGS DO: an owner-only
 * gate. The page that renders this checks MANAGE_COMPLIANCE, not OWNER —
 * see that action's own doc comment for why.
 */

type Props = { crew: RegisterCrew[]; existing: ExistingRegisterEntry[] };
type Result = { ok: boolean; message: string };

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const chip = "rounded-full border px-2 py-0.5";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

const FIELD_LABEL: Record<RegisterField, string> = {
  employeeName: "Employee (one column)",
  firstName: "First name",
  lastName: "Last name",
  employeeNumber: "Employee number",
  ssnLast4: "Last 4 of SSN",
  periodStart: "Period start",
  periodEnd: "Period end",
  payDate: "Pay date",
  hours: "Hours",
  gross: "Gross pay",
  deductionsTotal: "Total deductions",
  net: "Net pay",
  federalTax: "Federal tax",
  socialSecurity: "Social Security tax",
  medicare: "Medicare tax",
  medicareAdditional: "Additional Medicare tax",
  stateTax: "State tax",
  otherDeductions: "Other deductions",
};

const REQUIRED_FIELDS: RegisterField[] = ["periodStart", "periodEnd", "gross", "net"];

export function PayrollRegisterImport({ crew, existing }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<RegisterOverrides>({});
  const [showMapping, setShowMapping] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const plan = useMemo(
    () => (text.trim() ? planPayrollRegisterImport(text, crew, existing, overrides) : null),
    [text, crew, existing, overrides],
  );

  function edit(next: string) {
    setText(next);
    setResult(null);
  }

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(TOO_LARGE_MESSAGE);
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      setFileError(
        "That is an Excel workbook. Open it in Excel, choose File → Save As → CSV, then choose the CSV here — or copy the cells and paste them below.",
      );
      return;
    }
    try {
      edit(await file.text());
    } catch {
      setFileError("Couldn't read that file. Try opening it and pasting the contents instead.");
    }
  }

  function setOverride(field: RegisterField, value: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === "") delete next[field];
      else if (value === "none") next[field] = null;
      else next[field] = Number(value);
      return next;
    });
  }

  function confirm() {
    const formData = new FormData();
    formData.set("csv", text);
    formData.set("mapping", JSON.stringify(overrides));
    startTransition(async () => {
      const outcome = await importPayrollRegister(formData);
      setResult(outcome.ok ? { ok: true, message: outcome.value.message } : { ok: false, message: outcome.error });
    });
  }

  if (!open) {
    return (
      <section className="rounded-lg border border-line-card bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-label">Payroll register, for certified payroll</h2>
            <p className="mt-1 text-xs text-ink-body">
              A weekly register from Gusto, ADP RUN, Sage 100 Contractor or Foundation. Fills the
              deductions, net wages and ID numbers a WH-347 needs and C Stream does not run payroll
              to compute.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
          >
            Import payroll register
          </button>
        </div>
      </section>
    );
  }

  const createCount = plan?.create.length ?? 0;
  const updateCount = plan?.update.length ?? 0;
  const changedCount = createCount + updateCount;
  const tooLarge = importTooLarge(text);

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">Payroll register, for certified payroll</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            edit("");
            setOverrides({});
            setFileError(null);
          }}
          className="min-h-11 px-2 text-xs text-ink-body hover:text-ink-label"
        >
          Close
        </button>
      </div>

      <p className="mb-2 text-xs text-ink-body">
        Export this week&apos;s payroll register as a spreadsheet, save it as CSV, and choose it here
        — or paste the cells straight from Excel or Google Sheets. C Stream never computes payroll;
        every dollar here is copied from what your payroll system already calculated.
      </p>
      <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
        <li>
          <span className="font-medium text-ink-label">Employee, Period start, Period end, Gross, Net</span> —
          required. One name column or First + Last, either works.
        </li>
        <li>
          <span className="font-medium text-ink-label">Total deductions</span> — recommended. Left
          out, deductions are derived as gross minus net, and the preview says so.
        </li>
        <li>
          <span className="font-medium text-ink-label">Last 4 of SSN, Employee number, Hours, Pay date, Federal/state/FICA/other</span>{" "}
          — optional. A whole Social Security number anywhere in a row refuses that row; only the
          last 4 is ever stored, on the crew list. Bank account and routing numbers are never read.
        </li>
      </ul>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => onFile(event.target.files?.[0])}
          aria-label="Choose a payroll register as a CSV file"
          className="min-h-11 text-xs text-ink-body file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-card file:bg-neutral-800 file:px-3 file:text-xs file:text-ink-label"
        />
      </div>
      {fileError && <p className="mb-3 text-xs text-tag-rose-ink">{fileError}</p>}

      <textarea
        value={text}
        onChange={(event) => edit(event.target.value)}
        rows={8}
        spellCheck={false}
        aria-label="Paste your payroll register"
        placeholder="Employee, Period start, Period end, Gross, Net, ..."
        className={`${inputClass} w-full font-mono text-xs`}
      />

      {plan && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`${chip} border-line-card bg-tag-green text-tag-green-ink`}>
              {createCount} new {createCount === 1 ? "line" : "lines"}
            </span>
            <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
              {updateCount} updated
            </span>
            <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
              {plan.unchanged.length} unchanged
            </span>
            <span className={`${chip} border-line-card bg-tag-amber text-tag-amber-ink`}>
              {plan.problems.length} with problems — skipped
            </span>
            {plan.source === "gusto" && (
              <span className={`${chip} border-line-card bg-canvas text-ink-label`}>Read as a Gusto export</span>
            )}
          </div>

          {plan.notes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-body">
              {plan.notes.map((note, i) => (
                <li key={i} className="rounded-md border border-line-card bg-canvas px-3 py-2">
                  {note}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setShowMapping((v) => !v)}
            className="mt-3 text-xs text-link hover:text-link-hover"
          >
            {showMapping ? "Hide" : "How your columns were read"}
          </button>
          {showMapping && (
            <div className="mt-2 overflow-x-auto rounded-md border border-line-row p-3">
              <p className="mb-2 text-xs text-ink-muted">
                Found: {plan.headers.length > 0 ? plan.headers.join(", ") : "no columns yet"}
                {plan.ignoredColumns.length > 0 && ` — not used: ${plan.ignoredColumns.join(", ")}`}
              </p>
              <table className="w-full min-w-[420px] text-left text-xs">
                <tbody className="divide-y divide-line-row">
                  {REGISTER_FIELD_LIST.filter(
                    (field) => plan.mapping[field] !== undefined || REQUIRED_FIELDS.includes(field),
                  ).map((field) => (
                    <tr key={field}>
                      <td className={`${td} text-ink-label`}>
                        {FIELD_LABEL[field]}
                        {REQUIRED_FIELDS.includes(field) && <span className="text-tag-rose-ink"> *</span>}
                      </td>
                      <td className={td}>
                        <select
                          className={`${inputClass} text-xs`}
                          value={
                            field in overrides
                              ? (overrides[field] === null ? "none" : String(overrides[field]))
                              : (plan.mapping[field] !== undefined ? String(plan.mapping[field]) : "")
                          }
                          onChange={(event) => setOverride(field, event.target.value)}
                        >
                          <option value="none">(not in this file)</option>
                          {plan.headers.map((header, i) => (
                            <option key={i} value={i}>
                              {header || `Column ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Problems problems={plan.problems} />

          {changedCount > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className={th}>Line</th>
                    <th className={th}>Crew member</th>
                    <th className={th}>Period</th>
                    <th className={th}>Gross</th>
                    <th className={th}>Deductions</th>
                    <th className={th}>Net</th>
                    <th className={th}>What happens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {[...plan.create, ...plan.update].slice(0, 25).map((row) => (
                    <tr key={row.line} className="text-ink-label">
                      <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                      <td className={td}>{row.crewLabel}</td>
                      <td className={`${td} text-ink-body`}>
                        {row.periodStart} – {row.periodEnd}
                      </td>
                      <td className={`${td} tabular-nums text-ink-body`}>${(row.grossCents / 100).toFixed(2)}</td>
                      <td className={`${td} tabular-nums text-ink-body`}>
                        ${(row.deductionsCents / 100).toFixed(2)}
                        {row.deductionsDerived && <span className="text-ink-muted"> (derived)</span>}
                      </td>
                      <td className={`${td} tabular-nums text-ink-body`}>${(row.netCents / 100).toFixed(2)}</td>
                      <td className={`${td} text-ink-body`}>
                        {(row as { changed?: string }).changed ?? "new"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {changedCount > 25 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 25 of {changedCount}. All of them will be saved.
                </p>
              )}
            </div>
          )}

          <ExistingList
            items={plan.unchanged.map((u) => ({ line: u.line, label: u.label }))}
            noun="register lines"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={pending || changedCount === 0 || tooLarge}
              aria-busy={pending || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? "Saving…"
                : changedCount === 0
                  ? "Nothing new to save"
                  : `Confirm — save ${changedCount} ${changedCount === 1 ? "line" : "lines"}`}
            </button>
            {tooLarge && <span className="text-xs text-tag-rose-ink">{TOO_LARGE_MESSAGE}</span>}
            <span className="text-xs text-ink-muted">Up to {MAX_IMPORT_ROWS} rows at a time.</span>
          </div>
        </div>
      )}

      {result && (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            result.ok ? "border-line-card bg-tag-green text-tag-green-ink" : "border-line-card bg-tag-rose text-tag-rose-ink"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
