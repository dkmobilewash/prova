"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importPriceList, readPriceListPdf, type PriceListImportResult } from "@/lib/actions";
import { readImportFile } from "@/lib/import-files";
import { contactEmailIn, guessColumns, planPriceList, priceListTable, readRow, type ColumnMap, type Need } from "@/lib/estimating/priceList";
import { localToday } from "./localToday";

const field = "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink";

/**
 * Import a supplier's quote or price list (CSV, Excel, or a PDF with a text layer). The columns are
 * guessed from the header and can be changed; every row is matched to a material by code and shown
 * with how its price was worked out; anything uncertain waits for a one-click pick; nothing is
 * written until Import. Mounted only when somebody opens it, so `localToday` is safe here.
 */
export function PriceListImport({ needs, rollLf, canImport }: { needs: Need[]; rollLf: number; canImport: boolean }) {
  const router = useRouter();
  const [vendor, setVendor] = useState("");
  // The supplier's email for orders: read off the list until somebody types their own.
  const [contactTyped, setContact] = useState<string | null>(null);
  const [quotedOn, setQuotedOn] = useState(localToday());
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapOverride, setMap] = useState<ColumnMap | null>(null);
  const [byKey, setByKey] = useState<Record<string, number>>({});
  const [byGroup, setByGroup] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<PriceListImportResult | null>(null);
  const [pending, start] = useTransition();

  const table = useMemo(() => priceListTable(text), [text]);
  const map = mapOverride ?? guessColumns(table.header);
  const contact = contactTyped ?? contactEmailIn(text) ?? "";
  const rows = useMemo(() => (map ? table.rows.map((r) => readRow(r, map, rollLf)) : []), [table, map, rollLf]);
  const plan = useMemo(() => planPriceList(rows, needs), [rows, needs]);
  const rowAt = new Map(rows.map((r) => [r.line, r]));
  const headers = table.header.length > 0 ? table.header : (table.rows[0]?.cells ?? []).map((_, i) => `Column ${i + 1}`);

  async function onFile(file: File | undefined) {
    setMessage(null);
    setDone(null);
    if (!file) return;
    setFileName(file.name);
    setMap(null);
    setByKey({});
    setByGroup({});
    if (/\.pdf$/i.test(file.name)) {
      const form = new FormData();
      form.set("file", file);
      const read = await readPriceListPdf(form);
      if (!read.ok) return setMessage(read.error);
      return setText(read.value.text);
    }
    const read = await readImportFile(file);
    if (!read.ok) return setMessage(read.message);
    setText(read.text);
  }

  const column = (name: keyof ColumnMap, optional: boolean) => (
    <label className="flex flex-col gap-1 text-xs text-ink-label">
      {name === "item" ? "Item" : name === "size" ? "Size" : name === "unit" ? "Unit" : "Price"}
      <select
        className={field}
        value={map?.[name] ?? ""}
        onChange={(e) => setMap({ ...(map ?? { item: 0, size: null, unit: null, price: 0 }), [name]: e.target.value === "" ? null : Number(e.target.value) })}
        data-price-list={`column-${name}`}
      >
        {optional && <option value="">—</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  const describe = (line: number) => {
    const r = rowAt.get(line)!;
    return `${r.description} — ${r.how}`;
  };

  if (!canImport) return <p className="text-sm text-ink-body">Only the account owner can import a supplier&apos;s prices into the price book.</p>;
  return (
    <div className="flex flex-col gap-4" data-price-list="import">
      <p className="max-w-prose text-sm text-ink-body">
        A supplier&apos;s quote or price list — CSV, Excel, or a PDF with real text. Each row is matched to your materials; the prices go into your price book and fill every estimate waiting on them. Nothing is priced from a row this can&apos;t read.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Supplier
          <input className={`${field} w-56`} value={vendor} onChange={(e) => setVendor(e.target.value)} name="vendorName" placeholder="Northgate Building Supply" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Their email for orders
          <input type="email" className={`${field} w-64`} value={contact} onChange={(e) => setContact(e.target.value)} name="contactEmail" placeholder="orders@supplier.com" data-price-list="contact" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Date on the quote
          <input type="date" className={field} value={quotedOn} onChange={(e) => setQuotedOn(e.target.value)} name="quotedOn" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          File
          <input type="file" accept=".csv,.txt,.xlsx,.pdf" onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm text-ink" data-price-list="file" />
        </label>
      </div>
      {message && <p className="text-sm text-tag-rose-ink">{message}</p>}

      {text !== "" && (
        <>
          <div className="flex flex-wrap gap-3" data-price-list="columns">
            {column("item", false)}
            {column("size", true)}
            {column("unit", true)}
            {column("price", false)}
          </div>
          {map === null ? (
            <p className="text-sm text-tag-amber-ink">Say which column is the item and which is the price.</p>
          ) : (
            <>
              <p className="text-sm text-ink" data-price-list="summary">
                {fileName}: {rows.length} rows · <b>{plan.matched.length}</b> priced on their own · <b>{plan.choose.length + plan.needsPick.length}</b> to pick · {plan.reference.length} kept for reference only
              </p>

              {plan.matched.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-ink">Priced</h3>
                  <ul className="text-xs text-ink-body" data-price-list="matched">
                    {plan.matched.map((m) => (
                      <li key={m.key} className="py-0.5">
                        {describe(m.line)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(plan.choose.length > 0 || plan.needsPick.length > 0) && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-ink">Pick one</h3>
                  {plan.choose.map((c) => (
                    <label key={c.key} className="flex flex-col gap-1 text-xs text-ink-label" data-price-list="choose" data-price-list-key={c.key}>
                      {c.why}
                      <select className={field} value={byKey[c.key] ?? ""} onChange={(e) => setByKey((p) => (e.target.value === "" ? omit(p, c.key) : { ...p, [c.key]: Number(e.target.value) }))}>
                        <option value="">Leave unpriced</option>
                        {c.lines.map((line) => (
                          <option key={line} value={line}>
                            {describe(line)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {plan.needsPick.map((n) => (
                    <label key={n.group} className="flex flex-col gap-1 text-xs text-ink-label" data-price-list="need" data-price-list-need={n.label}>
                      Your estimate needs &ldquo;{n.label}&rdquo;, and the drawing doesn&apos;t say enough to know which row it is:
                      <select className={field} value={byGroup[n.group] ?? ""} onChange={(e) => setByGroup((p) => (e.target.value === "" ? omit(p, n.group) : { ...p, [n.group]: Number(e.target.value) }))}>
                        <option value="">Leave unpriced</option>
                        {n.lines.map((line) => (
                          <option key={line} value={line}>
                            {describe(line)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </section>
              )}

              {plan.reference.length > 0 && (
                <details className="text-xs text-ink-body">
                  <summary className="cursor-pointer text-ink-label">{plan.reference.length} rows kept for reference only — they price nothing</summary>
                  <ul data-price-list="reference">
                    {plan.reference.map((r) => (
                      <li key={r.line} className="py-0.5">
                        {rowAt.get(r.line)?.description || `Row ${r.line}`} — {r.why}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending || vendor.trim() === ""}
                  onClick={() =>
                    start(async () => {
                      setMessage(null);
                      const result = await importPriceList({ vendorName: vendor, quotedOn, text, map, picks: { byKey, byGroup }, contactEmail: contact });
                      if (!result.ok) return setMessage(result.error);
                      setDone(result.value);
                      router.refresh();
                    })
                  }
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
                  data-price-list="import-button"
                >
                  {pending ? "Importing…" : "Import prices"}
                </button>
                {vendor.trim() === "" && <span className="text-xs text-ink-muted">Name the supplier first.</span>}
              </div>
            </>
          )}
        </>
      )}
      {done && (
        <p role="status" className="text-sm text-ink" data-price-list="done">
          {done.prices} prices in your price book from {done.quotes} rows. {done.priced} estimate lines priced on {done.jobs} job{done.jobs === 1 ? "" : "s"}.
          {done.noMarkup > 0 ? ` ${done.noMarkup} job${done.noMarkup === 1 ? " has" : "s have"} no markup set, so their lines wait.` : ""}
        </p>
      )}
    </div>
  );
}

function omit<T extends Record<string, number>>(o: T, k: string): T {
  const { [k]: _gone, ...rest } = o;
  return rest as T;
}
