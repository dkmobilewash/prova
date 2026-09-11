"use client";

import { useMemo, useRef, useState } from "react";
import { importCatalogEntries } from "@/lib/actions";
import { MAX_IMPORT_ROWS, parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import { money } from "@/lib/money";
import { tradeScopeLabel } from "@/lib/trade-scopes";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Paste a price list, see exactly what will happen, then commit.
 *
 * The preview is the point. Bulk import is the fastest way to put two
 * hundred wrong numbers into a catalog, and every bid built from that
 * catalog afterwards inherits them — so nothing is written until the user
 * has seen the parsed rows, the ones that will be skipped, and why.
 *
 * Parsing here is for display only. The server re-parses the same text with
 * the same function and decides what to write from that, so what lands can
 * never be something the browser invented.
 */

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

const SAMPLE = `Description,Unit,Unit Price,Cost,Hours,Trade
5/8" Type X board,SF,2.85,1.90,0.012,drywall
Corner bead,LF,1.20,0.60,0.03,drywall
Level 5 finish,SF,1.75,0.95,0.02,drywall`;

export function CatalogImport({ existingDescriptions }: { existingDescriptions: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseCatalogImport(text) : null), [text]);
  const split = useMemo(
    () => (parsed ? splitAgainstExisting(parsed.rows, existingDescriptions) : null),
    [parsed, existingDescriptions],
  );

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 1_000_000) {
      setFileError("That file is over 1 MB — split it and import in parts.");
      return;
    }
    try {
      setText(await file.text());
    } catch {
      setFileError("Couldn't read that file. Try opening it and pasting the contents instead.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
      >
        Import a price list
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">Import a price list</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setFileError(null);
          }}
          className="text-xs text-ink-body hover:text-ink-label"
        >
          Cancel
        </button>
      </div>

      <p className="mb-3 text-xs text-ink-body">
        Paste from a spreadsheet or choose a CSV. The first row must name the columns — one of them
        called <span className="text-ink-label">Description</span> (or Item, or Name). Unit, Price,
        Cost, Hours and Trade are all optional, and column names don&apos;t have to match exactly.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => onFile(event.target.files?.[0])}
          className="text-xs text-ink-body file:mr-3 file:rounded-md file:border file:border-line-card file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:text-ink-label"
        />
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          className="text-xs text-link hover:underline"
        >
          Show me an example
        </button>
      </div>
      {fileError && <p className="mb-3 text-xs text-tag-rose-ink">{fileError}</p>}

      <textarea
        name="csvPreview"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={"Description,Unit,Unit Price,Cost\n5/8\" Type X board,SF,2.85,1.90"}
        className={`${inputClass} w-full font-mono text-xs`}
      />

      {parsed && split && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-700 bg-tag-green px-2 py-0.5 text-tag-green-ink">
              {split.fresh.length} to add
            </span>
            {split.duplicatesOfExisting.length > 0 && (
              <span className="rounded-full border border-neutral-400 bg-neutral-800 px-2 py-0.5 text-ink-label">
                {split.duplicatesOfExisting.length} already in the catalog — skipped
              </span>
            )}
            {split.duplicatesWithinFile.length > 0 && (
              <span className="rounded-full border border-neutral-400 bg-neutral-800 px-2 py-0.5 text-ink-label">
                {split.duplicatesWithinFile.length} repeated in the file — skipped
              </span>
            )}
            {parsed.problems.length > 0 && (
              <span className="rounded-full border border-amber-700 bg-tag-amber px-2 py-0.5 text-tag-amber-ink">
                {parsed.problems.length} couldn&apos;t be read
              </span>
            )}
          </div>

          {parsed.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Columns not used: {parsed.ignoredColumns.join(", ")}. If a price is in one of those,
              rename its header and paste again.
            </p>
          )}

          {parsed.problems.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {parsed.problems.slice(0, 8).map((problem) => (
                <li key={`${problem.line}-${problem.message}`} className="text-xs text-tag-amber-ink">
                  Line {problem.line}: {problem.message}
                </li>
              ))}
              {parsed.problems.length > 8 && (
                <li className="text-xs text-ink-muted">
                  …and {parsed.problems.length - 8} more.
                </li>
              )}
            </ul>
          )}

          {split.fresh.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line-row">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2 font-medium">Hours</th>
                    <th className="px-3 py-2 font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-row">
                  {split.fresh.slice(0, 12).map((row) => (
                    <tr key={row.line} className="text-ink-label">
                      <td className="px-3 py-1.5">{row.description}</td>
                      <td className="px-3 py-1.5 text-ink-body">{row.unit ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.unitPrice != null ? money(row.unitPrice) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.budgetedUnitCost != null ? money(row.budgetedUnitCost) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-ink-body">
                        {row.laborHours ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-ink-body">
                        {tradeScopeLabel(row.tradeScope) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {split.fresh.length > 12 && (
                <p className="border-t border-line-row px-3 py-2 text-xs text-ink-muted">
                  Showing the first 12 of {split.fresh.length}. All of them will be added.
                </p>
              )}
            </div>
          )}

          <form action={importCatalogEntries} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="csv" value={text} />
            <SubmitButton
              type="submit"
              disabled={split.fresh.length === 0}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
            >
              {split.fresh.length === 1 ? "Add 1 entry" : `Add ${split.fresh.length} entries`}
            </SubmitButton>
            <span className="text-xs text-ink-muted">
              Nothing already in the catalog is changed. Up to {MAX_IMPORT_ROWS} rows at a time.
            </span>
          </form>
        </div>
      )}
    </section>
  );
}
