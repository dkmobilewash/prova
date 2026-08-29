"use client";

import { useMemo, useRef, useState } from "react";
import { importCatalogEntries } from "@/lib/actions";
import { MAX_IMPORT_ROWS, parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import { money } from "@/lib/money";
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
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

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
        className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
      >
        Import a price list
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Import a price list</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
            setFileError(null);
          }}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        Paste from a spreadsheet or choose a CSV. The first row must name the columns — one of them
        called <span className="text-slate-300">Description</span> (or Item, or Name). Unit, Price,
        Cost, Hours and Trade are all optional, and column names don&apos;t have to match exactly.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => onFile(event.target.files?.[0])}
          className="text-xs text-slate-400 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
        />
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          className="text-xs text-blue-400 hover:underline"
        >
          Show me an example
        </button>
      </div>
      {fileError && <p className="mb-3 text-xs text-rose-300">{fileError}</p>}

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
            <span className="rounded-full border border-emerald-700 bg-emerald-950 px-2 py-0.5 text-emerald-300">
              {split.fresh.length} to add
            </span>
            {split.duplicatesOfExisting.length > 0 && (
              <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-300">
                {split.duplicatesOfExisting.length} already in the catalog — skipped
              </span>
            )}
            {split.duplicatesWithinFile.length > 0 && (
              <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-300">
                {split.duplicatesWithinFile.length} repeated in the file — skipped
              </span>
            )}
            {parsed.problems.length > 0 && (
              <span className="rounded-full border border-amber-700 bg-amber-950 px-2 py-0.5 text-amber-300">
                {parsed.problems.length} couldn&apos;t be read
              </span>
            )}
          </div>

          {parsed.ignoredColumns.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Columns not used: {parsed.ignoredColumns.join(", ")}. If a price is in one of those,
              rename its header and paste again.
            </p>
          )}

          {parsed.problems.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {parsed.problems.slice(0, 8).map((problem) => (
                <li key={`${problem.line}-${problem.message}`} className="text-xs text-amber-300">
                  Line {problem.line}: {problem.message}
                </li>
              ))}
              {parsed.problems.length > 8 && (
                <li className="text-xs text-slate-500">
                  …and {parsed.problems.length - 8} more.
                </li>
              )}
            </ul>
          )}

          {split.fresh.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-slate-800">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2 font-medium">Hours</th>
                    <th className="px-3 py-2 font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {split.fresh.slice(0, 12).map((row) => (
                    <tr key={row.line} className="text-slate-300">
                      <td className="px-3 py-1.5">{row.description}</td>
                      <td className="px-3 py-1.5 text-slate-400">{row.unit ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.unitPrice != null ? money(row.unitPrice) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.budgetedUnitCost != null ? money(row.budgetedUnitCost) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-slate-400">
                        {row.laborHours ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400">
                        {row.tradeScope ? row.tradeScope.replaceAll("_", " ").toLowerCase() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {split.fresh.length > 12 && (
                <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
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
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              {split.fresh.length === 1 ? "Add 1 entry" : `Add ${split.fresh.length} entries`}
            </SubmitButton>
            <span className="text-xs text-slate-500">
              Nothing already in the catalog is changed. Up to {MAX_IMPORT_ROWS} rows at a time.
            </span>
          </form>
        </div>
      )}
    </section>
  );
}
