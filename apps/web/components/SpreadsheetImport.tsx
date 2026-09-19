"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { importClients, importCrew, importJobs, importPhaseCodes } from "@/lib/actions";
import {
  CLIENT_COLUMNS,
  CLIENT_FIELD_OPTIONS,
  CONTACT_TYPE_WORDS,
  CREW_COLUMNS,
  CREW_FIELD_OPTIONS,
  IMPORT_TEMPLATES,
  JOB_COLUMNS,
  JOB_FIELD_OPTIONS,
  JOB_STATUS_WORDS,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
  PHASE_CODE_COLUMNS,
  PHASE_CODE_FIELD_OPTIONS,
  TOO_LARGE_MESSAGE,
  crewName,
  importTooLarge,
  mapColumns,
  planClientImport,
  planCrewImport,
  planJobImport,
  planPhaseCodeImport,
  type ExistingCrew,
  type ExistingJob,
  type ExistingMatch,
  type FieldOption,
  type ImportKind,
  type JobClient,
  type JobPlanRow,
  type RowProblem,
} from "@/lib/spreadsheet-import";
import { applyColumnMapping, headerOf, type ColumnMapping } from "@/lib/import-mapping";
import { matchPreset, presetMapping } from "@/lib/import-presets";

/**
 * Paste or upload a spreadsheet, see exactly what will happen, then confirm.
 *
 * Same arrangement as CatalogImport: the parse here is for DISPLAY. The
 * confirm sends the raw text, and the server parses it again with the same
 * function against a fresh read of what exists — so what lands can never be
 * something this component invented.
 *
 * WHAT IS IN STATE AND WHAT IS NOT. The pasted text and the last result are
 * state — they are this person's input. What already exists is NOT: it
 * arrives as props and the preview is recomputed from those props on every
 * render. Copying them into useState would freeze the first answer, so
 * after a confirm the page's revalidation would bring new rows that the
 * preview never saw, and the same file would still show "will be added".
 */

type Props =
  | { kind: "clients"; existingContactNames: string[] }
  | { kind: "jobs"; existingContactNames: string[]; existingJobs: ExistingJob[] }
  | { kind: "crew"; existingCrew: ExistingCrew[] }
  | { kind: "costCodes"; existingPhaseCodeCodes: string[] };

type Result = { ok: true; message: string } | { ok: false; message: string };

const COPY: Record<ImportKind, { title: string; button: string; noun: [string, string] }> = {
  clients: { title: "Clients", button: "Import clients", noun: ["client", "clients"] },
  jobs: { title: "Jobs", button: "Import jobs", noun: ["job", "jobs"] },
  crew: { title: "Crew", button: "Import crew", noun: ["crew member", "crew members"] },
  costCodes: { title: "Cost codes", button: "Import cost codes", noun: ["cost code", "cost codes"] },
};

/** The alias table each kind guesses a mapping from, and the labelled
 * field list its mapping UI offers — one place tying `ImportKind` to the
 * two tables lib/spreadsheet-import.ts keeps beside each kind's parser. */
const ALIASES: Record<ImportKind, Record<string, readonly string[]>> = {
  clients: CLIENT_COLUMNS,
  jobs: JOB_COLUMNS,
  crew: CREW_COLUMNS,
  costCodes: PHASE_CODE_COLUMNS,
};

const FIELD_OPTIONS: Record<ImportKind, FieldOption<string>[]> = {
  clients: CLIENT_FIELD_OPTIONS,
  jobs: JOB_FIELD_OPTIONS,
  crew: CREW_FIELD_OPTIONS,
  costCodes: PHASE_CODE_FIELD_OPTIONS,
};

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const chip = "rounded-full border px-2 py-0.5";

function ColumnHelp({ kind }: { kind: ImportKind }) {
  const Row = ({ name, children }: { name: string; children: React.ReactNode }) => (
    <li>
      <span className="font-medium text-ink-label">{name}</span> — {children}
    </li>
  );

  if (kind === "clients") {
    return (
      <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
        <Row name="Name">required. The company you work for or buy from.</Row>
        <Row name="Type">
          GC, Developer, Vendor or Sub (&ldquo;general contractor&rdquo;, &ldquo;owner&rdquo;,
          &ldquo;supplier&rdquo; and &ldquo;subcontractor&rdquo; work too). Left blank, it is
          saved as General contractor — the preview says so on each row.
        </Row>
        <Row name="Email, Phone, Address">optional.</Row>
      </ul>
    );
  }
  if (kind === "jobs") {
    return (
      <>
        <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
          <Row name="Job name">required.</Row>
          <Row name="Client">
            required. Matched to a client you already have, ignoring capitals. A client that
            isn&apos;t in C Stream yet is added once, however many jobs name it — the preview
            shows which.
          </Row>
          <Row name="Status">
            optional — Estimate, Contracted, In progress or Complete. Every job comes in as an{" "}
            <span className="text-ink-label">estimate</span> whatever this says: a job becomes
            contracted on its own page, once it has line items and a signed contract, the same as
            any other job. Leave out finished jobs you don&apos;t want showing as estimates.
          </Row>
          <Row name="Start date, End date">optional. 2026-03-01 or 3/1/2026.</Row>
          <Row name="Scope">optional. A short description of the work.</Row>
        </ul>
        <p className="mb-3 rounded-md border border-line-card bg-canvas px-3 py-2 text-xs text-ink-body">
          <span className="font-medium text-ink-label">No contract value column, on purpose.</span>{" "}
          A job&apos;s value in C Stream is the sum of its line items, so it is built on the job
          page, not typed in here. A value, amount or price column in your file is left out and
          named in the preview.
        </p>
      </>
    );
  }
  if (kind === "costCodes") {
    return (
      <>
        <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
          <Row name="Code">required. As your company writes it — 04112.</Row>
          <Row name="Name">required, or a Description column. What it is, in your words.</Row>
          <Row name="Unit">optional — SF, LF, EA, HR.</Row>
        </ul>
        <p className="mb-3 rounded-md border border-line-card bg-canvas px-3 py-2 text-xs text-ink-body">
          <span className="font-medium text-ink-label">Brought in as phase codes.</span> A code
          already in C Stream is left alone, matched exactly (not case-folded — 04112 and 04112-A
          stay different codes, the same way the database tells them apart). Nothing is ever
          deleted here: retiring a code you no longer use is done on{" "}
          <span className="text-ink-label">Phase codes</span>, one at a time, after the import.
        </p>
      </>
    );
  }
  return (
    <>
      <ul className="mb-3 flex flex-col gap-1 text-xs text-ink-body">
        <Row name="First name, Last name">
          required, as two columns — the legal name a certified payroll prints. Middle name is
          optional. A single Name column isn&apos;t split for you.
        </Row>
        <Row name="Employee number">optional. Your own badge or payroll number.</Row>
        <Row name="Last 4 of SSN">
          optional, and <span className="text-ink-label">only the last 4 digits</span>. A whole
          Social Security number is refused and nothing from that row is saved. If a number
          starting with 0 shows as 3 digits, format that column as Text in your spreadsheet.
        </Row>
        <Row name="Phone, Address, Address 2, City, State, Zip">optional.</Row>
        <Row name="Hire date">optional. 2026-03-01 or 3/1/2026.</Row>
      </ul>
      <p className="mb-3 text-xs text-ink-muted">
        A name can&apos;t be edited after it is saved — a filed payroll has to keep saying the same
        thing — so check the spelling in the preview before you confirm.
      </p>
    </>
  );
}

function clientNote(client: JobClient): string {
  if (client.kind === "existing") return "your client";
  if (client.kind === "new") return "new client — added";
  return `new client — added by line ${client.line}`;
}

/** Also used by the Jobber import (JobberImport.tsx), whose rows have no
 * line numbers — `showLine={false}` drops the "Line N:" prefix. */
export function ExistingList({ items, noun, showLine = true }: { items: ExistingMatch[]; noun: string; showLine?: boolean }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border border-line-row px-3 py-2 text-xs text-ink-body">
      <summary className="cursor-pointer text-ink-label">
        {items.length} already in C Stream — left alone
      </summary>
      <ul className="mt-2 flex flex-col gap-0.5">
        {items.slice(0, 50).map((item) => (
          <li key={item.line}>
            {showLine && `Line ${item.line}: `}
            {item.label}
          </li>
        ))}
        {items.length > 50 && <li className="text-ink-muted">…and {items.length - 50} more {noun}.</li>}
      </ul>
    </details>
  );
}

export function Problems({ problems, showLine = true }: { problems: RowProblem[]; showLine?: boolean }) {
  if (problems.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-0.5">
      {problems.slice(0, 20).map((problem) => (
        <li key={`${problem.line}-${problem.message}`} className="text-xs text-tag-amber-ink">
          {showLine && `Line ${problem.line}: `}
          {problem.message}
        </li>
      ))}
      {problems.length > 20 && (
        <li className="text-xs text-ink-muted">…and {problems.length - 20} more.</li>
      )}
    </ul>
  );
}

/**
 * Said once, above the table, whenever the sheet marks any job as anything
 * but an estimate — because the per-row "sheet says Contracted" is easy to
 * miss, and the table only shows the first 25 rows.
 *
 * Every imported job lands as an ESTIMATE, whatever the sheet says. A job
 * becomes contracted on its own page, through the same evidence gate as any
 * other job (line items, and a signed or recorded contract). An import that
 * wrote CONTRACTED would be a second door into billing with no evidence
 * behind it. Decided by Cyrus; see the note at the top of
 * lib/spreadsheet-import.ts.
 */
export function EstimateNotice({ rows }: { rows: Pick<JobPlanRow, "sheetStatus">[] }) {
  const marked = rows.filter((row) => row.sheetStatus && row.sheetStatus !== "ESTIMATE");
  if (marked.length === 0) return null;
  const counts = new Map<string, number>();
  for (const row of marked) {
    const word = JOB_STATUS_WORDS[row.sheetStatus!];
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const listed = [...counts].map(([word, n]) => `${n} ${word}`).join(", ");
  return (
    <p role="note" className="mt-3 rounded-md border border-line-card bg-tag-amber px-3 py-2 text-xs text-tag-amber-ink">
      <span className="font-semibold">
        {marked.length === 1 ? "1 job" : `${marked.length} jobs`} will come in as an estimate, not as
        your sheet marks {marked.length === 1 ? "it" : "them"} ({listed}).
      </span>{" "}
      Every imported job starts as an estimate. To make one contracted, open it, add its line items
      and its signed contract, and mark it contracted there — the same as any other job.
    </p>
  );
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

export function SpreadsheetImport(props: Props) {
  const { kind } = props;
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Recomputed from props every render — see the note at the top.
  const plan = useMemo(() => {
    if (!text.trim()) return null;
    if (props.kind === "clients") return { kind: "clients" as const, ...planClientImport(text, props.existingContactNames) };
    if (props.kind === "jobs") {
      return { kind: "jobs" as const, ...planJobImport(text, props.existingContactNames, props.existingJobs) };
    }
    return { kind: "crew" as const, ...planCrewImport(text, props.existingCrew) };
  }, [text, props]);

  const template = IMPORT_TEMPLATES[kind];
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(template.csv)}`;

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
      setFileError("That is an Excel workbook. In Excel choose File → Save As → CSV, then choose the CSV here — or copy the cells and paste them below.");
      return;
    }
    try {
      edit(await file.text());
    } catch {
      setFileError("Couldn't read that file. Try opening it and pasting the contents instead.");
    }
  }

  function confirm() {
    const formData = new FormData();
    formData.set("csv", text);
    const action = kind === "clients" ? importClients : kind === "jobs" ? importJobs : importCrew;
    startTransition(async () => {
      const outcome = await action(formData);
      setResult(outcome.ok ? { ok: true, message: outcome.value.message } : { ok: false, message: outcome.error });
    });
  }

  if (!open) {
    return (
      <section className="rounded-lg border border-line-card bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-label">{copy.title}</h2>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
          >
            {copy.button}
          </button>
        </div>
      </section>
    );
  }

  const createCount = plan?.create.length ?? 0;
  // Checked here as well as in the action: over Next's body limit the
  // confirm would never reach the action, only the error page.
  const tooLarge = importTooLarge(text);

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">{copy.title}</h2>
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
        The first row must name the columns. Names don&apos;t have to match exactly, and columns
        can be in any order.
      </p>
      <ColumnHelp kind={kind} />

      <div className="mb-3 flex flex-wrap items-center gap-3" data-tour="import-file">
        <a
          href={templateHref}
          download={template.fileName}
          className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-xs text-ink-label hover:bg-neutral-800"
        >
          Download a blank template
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => onFile(event.target.files?.[0])}
          aria-label={`Choose a CSV file of ${copy.noun[1]}`}
          className="min-h-11 text-xs text-ink-body file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-card file:bg-neutral-800 file:px-3 file:text-xs file:text-ink-label"
        />
      </div>
      {fileError && <p className="mb-3 text-xs text-tag-rose-ink">{fileError}</p>}

      <textarea
        data-tour="import-paste"
        value={text}
        onChange={(event) => edit(event.target.value)}
        rows={8}
        spellCheck={false}
        aria-label={`Paste ${copy.noun[1]} from a spreadsheet`}
        placeholder={template.csv.split("\n")[0]}
        className={`${inputClass} w-full font-mono text-xs`}
      />

      {plan && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs" data-tour="import-preview">
            <span className={`${chip} border-line-card bg-tag-green text-tag-green-ink`}>
              {createCount} will be added
            </span>
            <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
              {plan.existing.length} already in C Stream
            </span>
            <span className={`${chip} border-line-card bg-tag-amber text-tag-amber-ink`}>
              {plan.problems.length} with problems — skipped
            </span>
            {plan.kind === "jobs" && plan.newClients.length > 0 && (
              <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
                {plan.newClients.length} new {plan.newClients.length === 1 ? "client" : "clients"} added for them
              </span>
            )}
          </div>

          {plan.kind === "jobs" && plan.moneyColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-body">
              Left out: {plan.moneyColumns.join(", ")}. A job&apos;s value is the sum of its line
              items, built on the job page.
            </p>
          )}
          {plan.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Columns not used: {plan.ignoredColumns.join(", ")}. If something you need is in one
              of those, rename its header to one listed above and paste again.
            </p>
          )}

          <Problems problems={plan.problems} />
          {plan.kind === "jobs" && <EstimateNotice rows={plan.create} />}

          {createCount > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[560px] text-left text-xs">
                {plan.kind === "clients" && (
                  <>
                    <thead className="text-ink-muted">
                      <tr>
                        <th className={th}>Line</th>
                        <th className={th}>Name</th>
                        <th className={th}>Type</th>
                        <th className={th}>Email</th>
                        <th className={th}>Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-row">
                      {plan.create.slice(0, 25).map((row) => (
                        <tr key={row.line} className="text-ink-label">
                          <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                          <td className={td}>{row.name}</td>
                          <td className={`${td} text-ink-body`}>
                            {CONTACT_TYPE_WORDS[row.accountType]}
                            {row.typeDefaulted && <span className="text-ink-muted"> (type was blank)</span>}
                          </td>
                          <td className={`${td} text-ink-body`}>{row.email ?? "—"}</td>
                          <td className={`${td} text-ink-body`}>{row.phone ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
                {plan.kind === "jobs" && (
                  <>
                    <thead className="text-ink-muted">
                      <tr>
                        <th className={th}>Line</th>
                        <th className={th}>Job</th>
                        <th className={th}>Client</th>
                        <th className={th}>Comes in as</th>
                        <th className={th}>Dates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-row">
                      {plan.create.slice(0, 25).map((row) => (
                        <tr key={row.line} className="text-ink-label">
                          <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                          <td className={td}>{row.name}</td>
                          <td className={`${td} text-ink-body`}>
                            {row.clientName}
                            <span className="block text-ink-muted">{clientNote(row.client)}</span>
                          </td>
                          <td className={`${td} text-ink-body`}>
                            Estimate
                            {row.sheetStatus && row.sheetStatus !== "ESTIMATE" && (
                              <span className="block text-tag-amber-ink">
                                sheet says {JOB_STATUS_WORDS[row.sheetStatus]}
                              </span>
                            )}
                          </td>
                          <td className={`${td} tabular-nums text-ink-body`}>
                            {row.startDate ?? "—"} to {row.endDate ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
                {plan.kind === "crew" && (
                  <>
                    <thead className="text-ink-muted">
                      <tr>
                        <th className={th}>Line</th>
                        <th className={th}>Legal name</th>
                        <th className={th}>Employee #</th>
                        <th className={th}>SSN last 4</th>
                        <th className={th}>Hired</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-row">
                      {plan.create.slice(0, 25).map((row) => (
                        <tr key={row.line} className="text-ink-label">
                          <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                          <td className={td}>{crewName(row)}</td>
                          <td className={`${td} text-ink-body`}>{row.employeeNumber ?? "—"}</td>
                          <td className={`${td} tabular-nums text-ink-body`}>
                            {row.identifyingNumberLast4 ? `•••-••-${row.identifyingNumberLast4}` : "—"}
                          </td>
                          <td className={`${td} tabular-nums text-ink-body`}>{row.hiredOn ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
              {createCount > 25 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 25 of {createCount}. All of them will be added.
                </p>
              )}
            </div>
          )}

          <ExistingList items={plan.existing} noun={copy.noun[1]} />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-tour="import-confirm"
              onClick={confirm}
              disabled={pending || createCount === 0 || tooLarge}
              aria-busy={pending || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? "Saving…"
                : createCount === 0
                  ? "Nothing new to add"
                  : `Confirm — add ${createCount} ${createCount === 1 ? copy.noun[0] : copy.noun[1]}`}
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
            result.ok
              ? "border-line-card bg-tag-green text-tag-green-ink"
              : "border-line-card bg-tag-rose text-tag-rose-ink"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
