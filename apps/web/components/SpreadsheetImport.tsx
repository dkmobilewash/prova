"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { importClients, importCrew, importJobs, importPhaseCodes, importVcfContacts, suggestImportColumnFields } from "@/lib/actions";
import { readImportFile } from "@/lib/import-files";
import {
  looksLikeVcf,
  planVcfImport,
  vcfDisplayRows,
  vcfWriteCount,
  type ExistingPerson,
} from "@/lib/vcf-import";
import {
  CONTACT_TYPE_WORDS,
  IMPORT_TEMPLATES,
  JOB_STATUS_WORDS,
  MAX_IMPORT_ROWS,
  TOO_LARGE_MESSAGE,
  crewName,
  importTooLarge,
  readRecords,
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
import { SKIPPED_PREFIX, applyColumnMapping } from "@/lib/import-mapping";
import { matchPreset } from "@/lib/import-presets";
import {
  KIND_FIELD_OPTIONS,
  KIND_WORDS,
  MAX_SAMPLE_ROWS,
  detectKind,
  proposeColumns,
  resolveColumns,
  toMapping,
  type ColumnOverride,
  type ReviewedColumn,
} from "@/lib/import-smart-map";
import { Spinner } from "@/components/Spinner";

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
 *
 * THE COLUMN MAPPING (`overrides`, below) is state for the same reason:
 * it is this person's input too, and it is never sent anywhere until
 * Import — see lib/import-mapping.ts for how it turns into the text the
 * server re-parses, with no separate write path of its own. The one call
 * before Import is "Suggest", which sends column names and five masked
 * sample rows to lib/actions/importSuggest.ts and writes nothing.
 */

type Props = (
  | { kind: "clients"; existingContactNames: string[]; existingPeople: ExistingPerson[] }
  | { kind: "jobs"; existingContactNames: string[]; existingJobs: ExistingJob[] }
  | { kind: "crew"; existingCrew: ExistingCrew[] }
  | { kind: "costCodes"; existingPhaseCodeCodes: string[] }
) & {
  /** The box's heading, when the section around it already names the kind. */
  title?: string;
  /** A file already chosen in the "any file" box above (AnyFileImport):
   * opens straight to the review, with no paste box or file picker of its own. */
  fromFile?: string;
};

type Result = { ok: true; message: string } | { ok: false; message: string };

const COPY: Record<ImportKind, { title: string; button: string; noun: [string, string]; listNoun: string }> = {
  clients: { title: "Clients", button: "Import clients", noun: ["client", "clients"], listNoun: "client list" },
  jobs: { title: "Jobs", button: "Import jobs", noun: ["job", "jobs"], listNoun: "job list" },
  crew: { title: "Crew", button: "Import crew", noun: ["crew member", "crew members"], listNoun: "crew list" },
  costCodes: {
    title: "Cost codes",
    button: "Import cost codes",
    noun: ["cost code", "cost codes"],
    listNoun: "cost-code list",
  },
};

/** Rows shown in the preview table; every row still imports. */
const PREVIEW_ROWS = 5;

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

const CONFIDENCE: Record<NonNullable<ReviewedColumn["confidence"]> | "skipped", { word: string; className: string }> = {
  exact: { word: "Exact name", className: "bg-tag-green text-tag-green-ink" },
  synonym: { word: "Similar name", className: "bg-canvas text-ink-label" },
  ai: { word: "AI guess — check it", className: "bg-tag-amber text-tag-amber-ink" },
  you: { word: "Your pick", className: "bg-canvas text-ink-label" },
  skipped: { word: "Skipped", className: "bg-canvas text-ink-muted" },
};

/**
 * The review screen: one row per column of THIS file — its header, a sample
 * value, the field C Stream proposes, how sure it is, and a dropdown to
 * change it or skip the column. Proposals come from lib/import-smart-map.ts
 * (dictionary) and lib/actions/importSuggest.ts (model, on request); the
 * person's pick always wins (`resolveColumns`). Nothing here writes anything.
 */
function ColumnReview({
  header,
  samples,
  columns,
  fieldOptions,
  onPick,
  presetLabel,
  onSuggest,
  suggesting,
  suggestNote,
}: {
  header: string[];
  samples: string[][];
  columns: ReviewedColumn[];
  fieldOptions: FieldOption<string>[];
  onPick: (index: number, field: string | null) => void;
  presetLabel: string | null;
  onSuggest: () => void;
  suggesting: boolean;
  suggestNote: string | null;
}) {
  const missing = fieldOptions.filter((option) => option.required && !columns.some((c) => c.field === option.field));
  const unplaced = columns.filter((column, index) => column.field === null && header[index]?.trim()).length;
  const labelOf = (field: string) => fieldOptions.find((option) => option.field === field)?.label ?? field;
  return (
    <div className="mb-3 rounded-md border border-line-card bg-canvas p-3" data-tour="import-mapping">
      {presetLabel && (
        <p className="mb-2 text-xs text-ink-body">
          <span className="font-medium text-ink-label">Looks like a {presetLabel}.</span> Check the
          columns below all the same.
        </p>
      )}
      <p className="mb-2 text-xs text-ink-body">
        Each of your columns, and where it goes in C Stream. Change any of them, or skip a column
        you don&apos;t want. Nothing is saved until you press Import.
      </p>
      <ul className="flex flex-col divide-y divide-line-row">
        {header.map((headerText, index) => {
          const column = columns[index] ?? { field: null, confidence: null };
          const badge = CONFIDENCE[column.confidence ?? "skipped"];
          const name = headerText.trim() || `Column ${index + 1}`;
          const sample = samples.find((row) => row[index]?.trim())?.[index]?.trim();
          return (
            <li key={index} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs">
                <span className="font-medium text-ink-label">{name}</span>
                {sample && <span className="block truncate text-ink-muted">e.g. {sample}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${chip} border-line-card text-xs ${badge.className}`}>{badge.word}</span>
                <select
                  value={column.field ?? ""}
                  onChange={(event) => onPick(index, event.target.value === "" ? null : event.target.value)}
                  aria-label={`Where the ${name} column goes`}
                  className={`${inputClass} min-h-11 text-xs`}
                >
                  <option value="">Skip this column</option>
                  {fieldOptions.map((option) => {
                    const holder = columns.findIndex((c) => c.field === option.field);
                    return (
                      <option key={option.field} value={option.field}>
                        {option.label}
                        {holder !== -1 && holder !== index ? ` (now: ${header[holder]?.trim() || `column ${holder + 1}`})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-tag-rose-ink">
          Still needed: {missing.map((option) => option.label).join(", ")} — pick the column that holds{" "}
          {missing.length === 1 ? "it" : "them"}.
        </p>
      )}
      {unplaced > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSuggest}
            disabled={suggesting}
            aria-busy={suggesting || undefined}
            className="min-h-11 rounded-md border border-line-card px-3 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-60"
          >
            {suggesting ? "Asking…" : `Suggest the ${unplaced} skipped ${unplaced === 1 ? "column" : "columns"}`}
          </button>
          <span className="text-xs text-ink-muted">
            Sends the column names and up to 5 rows (numbers hidden) to the assistant. Uses one
            assistant question.
          </span>
        </div>
      )}
      {suggestNote && <p className="mt-2 text-xs text-ink-body">{suggestNote}</p>}
      {columns.some((c) => c.confidence === "ai") && (
        <p className="mt-2 text-xs text-ink-muted">
          AI guesses: {columns.flatMap((c, i) => (c.confidence === "ai" && c.field ? [`${header[i]} → ${labelOf(c.field)}`] : [])).join(", ")}.
        </p>
      )}
    </div>
  );
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

export function SpreadsheetImport(props: Props) {
  const { kind } = props;
  const copy = props.title ? { ...COPY[kind], title: props.title } : COPY[kind];
  const fieldOptions = KIND_FIELD_OPTIONS[kind];
  const fromFile = props.fromFile;
  const [open, setOpen] = useState(fromFile !== undefined);
  const [text, setText] = useState(fromFile ?? "");
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [overrides, setOverrides] = useState<ColumnOverride[]>([]);
  const [aiMatches, setAiMatches] = useState<Record<number, string>>({});
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggesting, startSuggest] = useTransition();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // A vCard in the clients box bypasses the column mapping entirely — it
  // isn't tabular, and lib/vcf-import.ts reads it on its own.
  const isVcf = kind === "clients" && looksLikeVcf(text);

  // Recomputed from `text`, never stored across a new paste or file (see
  // `edit`, below, which clears every pick the moment the text changes).
  const records = useMemo(() => (!isVcf && text.trim() ? readRecords(text) : null), [text, isVcf]);
  const header = records?.header ?? null;
  const samples = useMemo(() => (records ? records.body.slice(0, MAX_SAMPLE_ROWS).map((row) => row.cells) : []), [records]);
  const preset = useMemo(() => (header ? matchPreset(kind, header) : null), [header, kind]);
  const proposals = useMemo(() => (header ? proposeColumns(kind, header) : []), [header, kind]);
  // Dictionary, then the model's guesses, then the person's own picks —
  // which always win (lib/import-smart-map.ts, `resolveColumns`).
  const columns = useMemo(() => resolveColumns(proposals, aiMatches, overrides), [proposals, aiMatches, overrides]);
  const labelFor = useMemo(
    () => Object.fromEntries(fieldOptions.map((option) => [option.field, option.label])),
    [fieldOptions],
  );
  // The text every parser below actually reads: identical to what was
  // pasted or uploaded except for its header line, which now says what the
  // person confirmed each column means, with every other column renamed
  // "Skipped: …" so no parser alias can pick it back up — see
  // lib/import-mapping.ts.
  const mappedText = useMemo(
    () => (header ? applyColumnMapping(text, toMapping(columns), labelFor, { skipUnmapped: true }) : text),
    [text, header, columns, labelFor],
  );

  function suggest() {
    if (!header) return;
    const unplaced = columns.flatMap((column, index) =>
      column.field === null && header[index]?.trim()
        ? [{ index, header: header[index], values: samples.map((row) => row[index] ?? "") }]
        : [],
    );
    setSuggestNote(null);
    startSuggest(async () => {
      const outcome = await suggestImportColumnFields({ kind, columns: unplaced });
      if (!outcome.ok) {
        setSuggestNote(outcome.error);
        return;
      }
      const found = Object.keys(outcome.value.matches).length;
      setAiMatches(outcome.value.matches);
      setSuggestNote(
        found === 0
          ? "No confident match for those columns — they stay skipped unless you pick one."
          : `Suggested ${found} — marked "AI guess". Check them before you import.`,
      );
    });
  }

  // Recomputed from props every render — see the note at the top.
  const plan = useMemo(() => {
    if (!text.trim()) return null;
    if (props.kind === "clients") {
      // A vCard in the clients box — chosen as a .vcf file or pasted —
      // takes the vCard planner; the same preview-then-Confirm follows.
      if (isVcf) {
        return { kind: "vcf" as const, ...planVcfImport(text, props.existingContactNames, props.existingPeople) };
      }
      return { kind: "clients" as const, ...planClientImport(mappedText, props.existingContactNames) };
    }
    if (props.kind === "jobs") {
      return { kind: "jobs" as const, ...planJobImport(mappedText, props.existingContactNames, props.existingJobs) };
    }
    if (props.kind === "crew") {
      return { kind: "crew" as const, ...planCrewImport(mappedText, props.existingCrew) };
    }
    return { kind: "costCodes" as const, ...planPhaseCodeImport(mappedText, props.existingPhaseCodeCodes) };
  }, [text, mappedText, isVcf, props]);

  const template = IMPORT_TEMPLATES[kind];
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(template.csv)}`;

  function edit(next: string) {
    setText(next);
    setResult(null);
    // A new file or a fresh paste gets a fresh guess — a mapping chosen for
    // the last file has no business surviving onto a different one.
    setOverrides([]);
    setAiMatches({});
    setSuggestNote(null);
  }

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (/\.vcf$/i.test(file.name) && kind !== "clients") {
      setFileError("A contacts (.vcf) file holds people, so it goes in the Clients box.");
      return;
    }
    // Size and .xls are refused before any parse; an .xlsx is converted in
    // the browser to the same CSV text a pasted sheet would be, so every
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
    formData.set("csv", isVcf ? text : mappedText);
    const action =
      kind === "clients"
        ? isVcf
          ? importVcfContacts
          : importClients
        : kind === "jobs"
          ? importJobs
          : kind === "crew"
            ? importCrew
            : importPhaseCodes;
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
            className="min-h-11 rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
          >
            {copy.button}
          </button>
        </div>
      </section>
    );
  }

  const createCount = plan ? (plan.kind === "vcf" ? vcfWriteCount(plan) : plan.create.length) : 0;
  // A vCard confirm writes contacts AND the people attached to them, so the
  // button counts and names "contacts" rather than "clients".
  const noun: [string, string] = plan?.kind === "vcf" ? ["contact", "contacts"] : copy.noun;
  // Checked here as well as in the action: over Next's body limit the
  // confirm would never reach the action, only the error page.
  const tooLarge = importTooLarge(isVcf ? text : mappedText);

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">{copy.title}</h2>
        {fromFile === undefined && (
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
        )}
      </div>

      {fromFile === undefined && (
      <>
      <p className="mb-2 text-xs text-ink-body">
        The first row must name the columns. Names don&apos;t have to match exactly, and columns
        can be in any order — or map them yourself below if they don&apos;t match at all, which is
        how any accounting system&apos;s export comes across, not only the ones C Stream
        recognises by name.
      </p>
      <ColumnHelp kind={kind} />

      <div className="mb-3 flex flex-wrap items-center gap-3" data-tour="import-file">
        <a
          href={templateHref}
          download={template.fileName}
          className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-xs text-ink-label hover:bg-rail-hover"
        >
          Download a blank template
        </a>
        <input
          ref={fileRef}
          type="file"
          accept={
            kind === "clients"
              ? ".csv,.tsv,.txt,.xlsx,.vcf,text/csv,text/plain,text/vcard,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : ".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }
          onChange={(event) => onFile(event.target.files?.[0])}
          aria-label={
            kind === "clients"
              ? "Choose a spreadsheet or phone-contacts file of clients"
              : `Choose a spreadsheet file of ${copy.noun[1]}`
          }
          className="min-h-11 text-xs text-ink-body file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-card file:bg-rail-hover file:px-3 file:text-xs file:text-ink-label"
        />
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        Excel files (.xlsx) work as-is — no saving as CSV first. The first sheet of the workbook is
        read.
        {kind === "clients" &&
          " From your phone, export or share your contacts and choose the .vcf file here — people with a company land under that company."}
      </p>
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
      </>
      )}

      {header && (
        <ColumnReview
          header={header}
          samples={samples}
          columns={columns}
          fieldOptions={fieldOptions}
          onPick={(index, field) => setOverrides((prev) => [...prev, { index, field }])}
          presetLabel={preset ? `${preset.vendorLabel} ${copy.listNoun}` : null}
          onSuggest={suggest}
          suggesting={suggesting}
          suggestNote={suggestNote}
        />
      )}

      {plan && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs" data-tour="import-preview">
            <span className={`${chip} border-line-card bg-tag-green text-tag-green-ink`}>
              {createCount} will be added
            </span>
            <span className={`${chip} border-line-card bg-canvas text-ink-label`}>
              {plan.existing.length} already in C Stream — skipped
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

          {plan.kind === "vcf" && (
            <p className="mt-2 text-xs text-ink-body">
              People with a company come in under that company, as its people. No client type (GC,
              Vendor, Sub) is set from a phone export — set it on Contacts when you need it.
            </p>
          )}
          {plan.kind === "jobs" && plan.moneyColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-body">
              Left out: {plan.moneyColumns.map((name) => name.replace(SKIPPED_PREFIX, "")).join(", ")}. A job&apos;s value is the sum of its line
              items, built on the job page.
            </p>
          )}
          {plan.kind !== "vcf" && plan.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Columns not used: {plan.ignoredColumns.map((name) => name.replace(SKIPPED_PREFIX, "")).join(", ")}.
              If something you need is in one of those, pick where it goes above.
            </p>
          )}

          <Problems problems={plan.problems} showLine={plan.kind !== "vcf"} />
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
                      {plan.create.slice(0, PREVIEW_ROWS).map((row) => (
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
                      {plan.create.slice(0, PREVIEW_ROWS).map((row) => (
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
                {plan.kind === "vcf" && (
                  <>
                    <thead className="text-ink-muted">
                      <tr>
                        <th className={th}>Card</th>
                        <th className={th}>Name</th>
                        <th className={th}>Lands as</th>
                        <th className={th}>Phone</th>
                        <th className={th}>Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-row">
                      {vcfDisplayRows(plan)
                        .slice(0, PREVIEW_ROWS)
                        .map((row) => (
                          <tr key={`${row.card}-${row.name}`} className="text-ink-label">
                            <td className={`${td} tabular-nums text-ink-muted`}>{row.card}</td>
                            <td className={td}>{row.name}</td>
                            <td className={`${td} text-ink-body`}>{row.note}</td>
                            <td className={`${td} text-ink-body`}>{row.phone}</td>
                            <td className={`${td} text-ink-body`}>{row.email}</td>
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
                      {plan.create.slice(0, PREVIEW_ROWS).map((row) => (
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
                {plan.kind === "costCodes" && (
                  <>
                    <thead className="text-ink-muted">
                      <tr>
                        <th className={th}>Line</th>
                        <th className={th}>Code</th>
                        <th className={th}>Name</th>
                        <th className={th}>Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-row">
                      {plan.create.slice(0, PREVIEW_ROWS).map((row) => (
                        <tr key={row.line} className="text-ink-label">
                          <td className={`${td} tabular-nums text-ink-muted`}>{row.line}</td>
                          <td className={`${td} tabular-nums`}>{row.code}</td>
                          <td className={td}>{row.name}</td>
                          <td className={`${td} text-ink-body`}>{row.unit ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
              {createCount > PREVIEW_ROWS && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first {PREVIEW_ROWS} of {createCount}. All of them will be imported.
                </p>
              )}
            </div>
          )}

          <ExistingList items={plan.existing} noun={noun[1]} showLine={plan.kind !== "vcf"} />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-tour="import-confirm"
              onClick={confirm}
              disabled={pending || createCount === 0 || tooLarge}
              aria-busy={pending || undefined}
              className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Saving…
                </span>
              ) : createCount === 0 ? (
                "Nothing new to add"
              ) : (
                `Import ${createCount} ${createCount === 1 ? noun[0] : noun[1]}`
              )}
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

/**
 * "Bring in what you already have" — the box for a person holding an export
 * who doesn't know (or care) which box below it belongs in. It reads the
 * file, guesses the kind from the headers (`detectKind`), lets the person
 * change it, and hands the text to the ordinary SpreadsheetImport for that
 * kind — so the review, the preview and the one Import action are exactly
 * the per-kind box's. Changing the kind remounts that box (its `key`),
 * dropping picks made for the other kind.
 */
export function AnyFileImport(props: {
  existingContactNames: string[];
  existingPeople: ExistingPerson[];
  existingJobs: ExistingJob[];
  existingCrew: ExistingCrew[];
  existingPhaseCodeCodes: string[];
  /** A file already read — for rendering the review without a click. */
  initialFile?: { name: string; text: string };
}) {
  const first = props.initialFile ? { ...props.initialFile, seq: 1 } : null;
  const [file, setFile] = useState<{ name: string; text: string; seq: number } | null>(first);
  const [kind, setKind] = useState<ImportKind | null>(first ? kindOf(first.text) : null);
  const [guessed, setGuessed] = useState(kind !== null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function onFile(chosen: File | undefined) {
    setFileError(null);
    if (!chosen) return;
    const read = await readImportFile(chosen);
    if (!read.ok) {
      setFileError(read.message);
      return;
    }
    const detected = kindOf(read.text);
    setFile((prev) => ({ name: chosen.name, text: read.text, seq: (prev?.seq ?? 0) + 1 }));
    setKind(detected);
    setGuessed(detected !== null);
  }

  const key = `${file?.seq ?? 0}-${kind}`;
  const common = { fromFile: file?.text ?? "", title: kind ? KIND_WORDS[kind] : undefined };
  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink-label">Bring in what you already have</h2>
      <p className="mb-3 text-xs text-ink-body">
        Choose an export from Sage 100 Contractor, Foundation, QuickBooks, Jobber, or any Excel or
        CSV file. C Stream works out what it holds and matches the columns for you — you check them
        before anything is saved.
      </p>
      <input
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.vcf,text/csv,text/plain,text/vcard,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => onFile(event.target.files?.[0])}
        aria-label="Choose any spreadsheet or export file"
        className="min-h-11 text-xs text-ink-body file:mr-3 file:min-h-11 file:rounded-md file:border file:border-line-card file:bg-rail-hover file:px-3 file:text-xs file:text-ink-label"
      />
      {fileError && <p className="mt-2 text-xs text-tag-rose-ink">{fileError}</p>}

      {file && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
            <span className="font-medium text-ink-label">This file holds</span>
            <select
              value={kind ?? ""}
              onChange={(event) => {
                setKind((event.target.value || null) as ImportKind | null);
                setGuessed(false);
              }}
              className={`${inputClass} min-h-11 text-xs`}
            >
              <option value="">Pick one…</option>
              {(Object.keys(KIND_WORDS) as ImportKind[]).map((one) => (
                <option key={one} value={one}>
                  {KIND_WORDS[one]}
                </option>
              ))}
            </select>
            <span className="text-ink-muted">
              {guessed
                ? `Guessed from the column names in ${file.name} — change it if that's wrong.`
                : kind
                  ? ""
                  : `Couldn't tell from the column names in ${file.name} — pick what it holds.`}
            </span>
          </label>
          {kind === "clients" && (
            <SpreadsheetImport
              key={key}
              kind="clients"
              existingContactNames={props.existingContactNames}
              existingPeople={props.existingPeople}
              {...common}
            />
          )}
          {kind === "jobs" && (
            <SpreadsheetImport
              key={key}
              kind="jobs"
              existingContactNames={props.existingContactNames}
              existingJobs={props.existingJobs}
              {...common}
            />
          )}
          {kind === "crew" && <SpreadsheetImport key={key} kind="crew" existingCrew={props.existingCrew} {...common} />}
          {kind === "costCodes" && (
            <SpreadsheetImport
              key={key}
              kind="costCodes"
              existingPhaseCodeCodes={props.existingPhaseCodeCodes}
              {...common}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** A phone-contacts file is always clients; anything else, by its headers. */
function kindOf(text: string): ImportKind | null {
  if (looksLikeVcf(text)) return "clients";
  const header = readRecords(text)?.header;
  return header ? detectKind(header) : null;
}
