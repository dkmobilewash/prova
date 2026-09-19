"use client";

import { useMemo, useState, useTransition } from "react";
import { importMyCoiExport } from "@/lib/actions";
import { MAX_IMPORT_ROWS, TOO_LARGE_MESSAGE, importTooLarge } from "@/lib/spreadsheet-import";
import { readImportFile } from "@/lib/import-files";
import {
  COI_TEMPLATE,
  planCoiImport,
  readCoiExport,
  type CoiPlanRow,
  type ExistingCoi,
  type KnownParties,
} from "@/lib/mycoi/import";
import { ExistingList, Problems } from "@/components/SpreadsheetImport";

/**
 * Paste or choose a myCOI export, see exactly what will be added, confirm.
 *
 * Same arrangement as SpreadsheetImport: the parse here is for DISPLAY
 * only. The confirm sends the raw text and the server parses it again,
 * against a fresh read, inside the transaction that writes. What already
 * exists arrives as props and is never copied into state, so after a
 * confirm the page's revalidation makes the same file preview as "already
 * here" — the on-screen proof a second confirm adds nothing.
 *
 * NOTHING IS WRITTEN UNTIL CONFIRM. `importMyCoiExport` is called from
 * `confirm()` and nowhere else; MyCoiImport.test.ts holds that.
 */

type Props = { existing: ExistingCoi[]; known: KnownParties };
type Result = { ok: boolean; message: string };

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const chip = "rounded-full border px-2 py-0.5";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

function matchNote(row: CoiPlanRow): string {
  if (row.match.kind === "vendor") return "your vendor";
  if (row.match.kind === "contact") return "your contact";
  return "not in your vendors — kept under this name";
}

export function MyCoiImport({ existing, known }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const plan = useMemo(
    () => (text.trim() ? planCoiImport(readCoiExport(text), existing, known) : null),
    [text, existing, known],
  );
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(COI_TEMPLATE.csv)}`;

  function edit(next: string) {
    setText(next);
    setResult(null);
  }

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    // Size and .xls are refused before any parse; an .xlsx is converted in
    // the browser to the same CSV text a pasted export would be, so every
    // guard on the text path applies to it unchanged (lib/import-files.ts).
    const read = await readImportFile(file);
    if (!read.ok) {
      setFileError(read.message);
      return;
    }
    edit(read.text);
  }

  function confirm() {
    const formData = new FormData();
    formData.set("csv", text);
    startTransition(async () => {
      const outcome = await importMyCoiExport(formData);
      setResult(outcome.ok ? { ok: true, message: outcome.value.message } : { ok: false, message: outcome.error });
    });
  }

  if (!open) {
    return (
      <section className="rounded-lg border border-line-card bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-label">Certificates of insurance, from myCOI</h2>
            <p className="mt-1 text-xs text-ink-body">
              Your vendors&apos; and subs&apos; insurance, from a myCOI export. Each line of cover lands on
              Compliance with its expiry date, and warns you before it runs out.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
          >
            Import certificates
          </button>
        </div>
      </section>
    );
  }

  const createCount = plan?.create.length ?? 0;
  const tooLarge = importTooLarge(text);

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">Certificates of insurance, from myCOI</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            edit("");
            setFileError(null);
          }}
          className="min-h-11 px-2 text-xs text-ink-body hover:text-ink-label"
        >
          Close
        </button>
      </div>

      <p className="mb-2 text-xs text-ink-body">
        In myCOI, export your vendors&apos; certificates or policies as a spreadsheet and choose it
        here — an Excel file (.xlsx) works as-is, no saving as CSV first. One row per vendor per
        line of cover is best. The first row must name the columns; they don&apos;t have to match
        exactly.
      </p>
      <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
        <li>
          <span className="font-medium text-ink-label">Vendor</span> — required (Insured or Company work too).
        </li>
        <li>
          <span className="font-medium text-ink-label">Expiration date</span> — required. 2026-03-01 or 3/1/2026.
        </li>
        <li>
          <span className="font-medium text-ink-label">Coverage</span> — strongly recommended (GL, Auto, Workers comp,
          Umbrella…). With it, next month&apos;s renewal replaces this month&apos;s row instead of leaving an
          expired one behind.
        </li>
        <li>
          <span className="font-medium text-ink-label">Carrier, Policy number, Effective date, Status</span> — optional.
          myCOI&apos;s status is kept in the notes as theirs; C Stream judges expiry from the date.
        </li>
      </ul>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <a
          href={templateHref}
          download={COI_TEMPLATE.fileName}
          className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-xs text-ink-label hover:bg-neutral-800"
        >
          Download a blank template
        </a>
        <input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => onFile(event.target.files?.[0])}
          aria-label="Choose a myCOI export (CSV or Excel)"
          className="min-h-11 text-xs text-ink-body file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-card file:bg-neutral-800 file:px-3 file:text-xs file:text-ink-label"
        />
      </div>
      {fileError && <p className="mb-3 text-xs text-tag-rose-ink">{fileError}</p>}

      <textarea
        value={text}
        onChange={(event) => edit(event.target.value)}
        rows={8}
        spellCheck={false}
        aria-label="Paste certificates from a myCOI export"
        placeholder={COI_TEMPLATE.csv.split("\n")[0]}
        className={`${inputClass} w-full font-mono text-xs`}
      />

      {plan && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs" data-tour="import-mycoi-preview">
            <span className={`${chip} border-line-card bg-tag-green text-tag-green-ink`}>{createCount} will be added</span>
            <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
              {plan.existing.length} already in C Stream
            </span>
            <span className={`${chip} border-line-card bg-tag-amber text-tag-amber-ink`}>
              {plan.problems.length} with problems — skipped
            </span>
          </div>

          {plan.noCoverageColumn && createCount > 0 && (
            <p role="note" className="mt-3 rounded-md border border-line-card bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
              This file has no Coverage column, so each row is treated as a whole certificate. A later
              renewal will be added beside it rather than replacing it, and the old one will keep
              showing as expired until you delete it. Add a Coverage column if your export has one.
            </p>
          )}
          {plan.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Columns not used: {plan.ignoredColumns.join(", ")}. If something you need is in one of
              those, rename its header to one listed above and paste again.
            </p>
          )}

          <Problems problems={plan.problems} />

          {createCount > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className={th}>Line</th>
                    <th className={th}>Vendor</th>
                    <th className={th}>Coverage</th>
                    <th className={th}>Expires</th>
                    <th className={th}>myCOI status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {plan.create.slice(0, 25).map((row) => (
                    <tr key={row.line} className="text-ink-label">
                      <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                      <td className={td}>
                        {row.vendorName}
                        <span className="block text-ink-muted">{matchNote(row)}</span>
                      </td>
                      <td className={`${td} text-ink-body`}>{row.coverage ?? "—"}</td>
                      <td className={`${td} tabular-nums text-ink-body`}>{row.expiresOn}</td>
                      <td className={`${td} text-ink-body`}>{row.sourceStatus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {createCount > 25 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 25 of {createCount}. All of them will be added.
                </p>
              )}
            </div>
          )}

          <ExistingList items={plan.existing} noun="certificates" />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-tour="import-mycoi-confirm"
              onClick={confirm}
              disabled={pending || createCount === 0 || tooLarge}
              aria-busy={pending || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? "Saving…"
                : createCount === 0
                  ? "Nothing new to add"
                  : `Confirm — add ${createCount} ${createCount === 1 ? "certificate" : "certificates"}`}
            </button>
            {tooLarge && <span className="text-xs text-tag-rose-ink">{TOO_LARGE_MESSAGE}</span>}
            <span className="text-xs text-ink-muted">
              Nothing already in C Stream is changed. Up to {MAX_IMPORT_ROWS} rows at a time.
            </span>
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
