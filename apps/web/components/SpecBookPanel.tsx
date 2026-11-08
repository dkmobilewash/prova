"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SpecTradeRead } from "@prova/integrations/src/specTrade";
import { addSpecDriverToProposal, findSpecBookSections, readSpecTrade, recordSpecBook } from "@/lib/actions";
import { uploadPlanSetFile } from "@/lib/document-upload-client";
import { Spinner } from "@/components/Spinner";
import type { WallTypeSpecCheck } from "@/lib/specs/specTradeFacts";

/**
 * ── THE SPECS TAB'S BOOK: upload it, see your sections, what they say, and where the legend disagrees ──
 *
 * One upload does three things in turn (`lib/actions/specBook.ts`): record the book,
 * find this trade's sections in it, and read each one. Each step's result is a
 * sentence on screen, and each can be pressed again by itself. Every fact shows the
 * spec's own words, and nothing reaches the proposal until Add is pressed.
 */
export type PanelSection = {
  id: string;
  sectionNumber: string;
  title: string | null;
  pages: string | null;
  fromBook: boolean;
  reading: { id: string; facts: SpecTradeRead; on: string } | null;
};

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:opacity-90 disabled:opacity-50";

export function SpecBookPanel({
  jobId,
  books,
  sections,
  wallTypes,
  hasLegend,
}: {
  jobId: string;
  books: { id: string; fileName: string | null; sectionCount: number }[];
  sections: PanelSection[];
  wallTypes: WallTypeSpecCheck[];
  hasLegend: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readAll(ids: string[]) {
    setBusy(`Reading ${ids.length} section${ids.length === 1 ? "" : "s"}…`);
    const results = await Promise.all(ids.map((id) => readSpecTrade(id).catch(() => ({ ok: false as const, error: "That did not go through." }))));
    const failed = results.filter((r) => !r.ok);
    setBusy(null);
    router.refresh();
    return failed.length === 0 ? `Read ${ids.length} of ${ids.length}.` : `Read ${ids.length - failed.length} of ${ids.length}. ${failed[0].ok ? "" : failed[0].error}`;
  }

  async function findAndRead(bookId: string) {
    setBusy("Finding your sections…");
    const found = await findSpecBookSections(bookId);
    if (!found.ok) {
      setBusy(null);
      setError(found.error);
      router.refresh();
      return;
    }
    const { trade, others, pages } = found.value;
    const head =
      trade.length === 0
        ? `No sections for your trades in ${pages} pages.`
        : `Found ${trade.length} section${trade.length === 1 ? "" : "s"} for your trades in ${pages} pages: ${trade.map((t) => t.number).join(", ")}.`;
    const skipped = others.length > 0 ? ` Skipped ${others.length} other: ${others.join(", ")}.` : "";
    setMessage(head + skipped);
    if (trade.length > 0) setMessage(`${head}${skipped} ${await readAll(trade.map((t) => t.id))}`);
    else setBusy(null);
  }

  async function upload(file: File) {
    setError(null);
    setMessage(null);
    setBusy("Uploading the spec book…");
    const uploaded = await uploadPlanSetFile(jobId, file);
    if (!uploaded.ok) {
      setBusy(null);
      setError(uploaded.error);
      return;
    }
    const book = await recordSpecBook(jobId, uploaded.fileUrl, uploaded.fileName ?? file.name);
    if (!book.ok) {
      setBusy(null);
      setError(book.error);
      return;
    }
    await findAndRead(book.value.bookId);
  }

  const bookSections = sections.filter((s) => s.fromBook);
  return (
    <section className="mt-4 rounded-lg border border-line-card bg-surface p-4" data-spec="book-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Spec book</h2>
          <p className="text-sm text-ink-muted">
            Upload the project manual. C-Stream finds your trade&apos;s sections (09 21 16, 09 22 16, 09 51 13, 07 81 00, 09 24 00, 07 24 00…) and
            reads each one. Reading uses plan reading&apos;s switch and your spec page allowance.
          </p>
        </div>
        <button type="button" className={primary} disabled={busy !== null} onClick={() => input.current?.click()} data-spec="upload">
          Upload the spec book
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          aria-label="Spec book PDF"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
      </div>

      {busy && (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-body" data-spec="busy">
          <Spinner /> {busy}
        </p>
      )}
      {message && <p className="mt-2 text-sm text-tag-green-ink" data-spec="message">{message}</p>}
      {error && <p className="mt-2 text-sm text-tag-rose-ink" data-spec="error">{error}</p>}

      {books.map((book) => (
        <div key={book.id} className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-body" data-spec="book" data-sections={book.sectionCount}>
          <span className="font-medium text-ink">{book.fileName ?? "Spec book"}</span>
          <span className="text-xs text-ink-muted">· {book.sectionCount} section{book.sectionCount === 1 ? "" : "s"} for your trades</span>
          {book.sectionCount === 0 && (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void findAndRead(book.id)} data-spec="find">
              Find the sections
            </button>
          )}
        </div>
      ))}

      {bookSections.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-line-card rounded-md border border-line-card">
          {bookSections.map((s) => (
            <SectionRow key={s.id} section={s} busy={busy !== null} onRead={async () => setMessage(await readAll([s.id]))} />
          ))}
        </ul>
      )}

      {wallTypes.length > 0 && (
        <div className="mt-4" data-spec="wall-types">
          <h3 className="text-sm font-semibold text-ink">Wall types against the spec</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line-card rounded-md border border-line-card">
            {wallTypes.map((w) => (
              <li key={w.code} className="flex flex-col gap-1 p-3 text-sm" data-spec="wall-type" data-code={w.code} data-conflicts={w.conflicts.length}>
                <span className="font-medium text-ink">{w.code}</span>
                {w.applies.length === 0 && <span className="text-xs text-ink-muted">Nothing in the spec sections read so far applies.</span>}
                {w.applies.map((line) => (
                  <span key={line} className="text-ink-body" data-spec="applies">{line}</span>
                ))}
                {w.conflicts.map((c) => (
                  <span key={c.what + c.sectionNumber} className="rounded bg-tag-rose px-2 py-1 text-xs text-tag-rose-ink" title={c.quote} data-spec="conflict">
                    Conflict, {c.what.toLowerCase()}: the legend says {c.legend}, {c.sectionNumber} says {c.spec} (&ldquo;{c.quote}&rdquo;)
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.some((s) => s.reading) && !hasLegend && (
        <p className="mt-3 text-xs text-ink-muted">No wall legend has been read on this job&apos;s plans yet, so wall types can&apos;t be checked against the spec.</p>
      )}
    </section>
  );
}

function SectionRow({ section, busy, onRead }: { section: PanelSection; busy: boolean; onRead: () => Promise<void> }) {
  const f = section.reading?.facts ?? null;
  const facts: { label: string; items: { text: string; quote: string }[] }[] = f
    ? [
        { label: "Studs", items: f.studs.map((s) => ({ text: [s.gauge, s.depth, s.spacing].filter(Boolean).join(" · "), quote: s.quote })) },
        { label: "Board", items: f.boards.map((b) => ({ text: [b.thickness, b.kind, b.where].filter(Boolean).join(" · "), quote: b.quote })) },
        { label: "Fire ratings", items: f.fireRatings.map((r) => ({ text: [r.rating, r.assembly].filter(Boolean).join(" · "), quote: r.quote })) },
        { label: "Ceilings", items: f.ceilings.map((c) => ({ text: [c.tile, c.grid].filter(Boolean).join(" · "), quote: c.quote })) },
        { label: "Finish levels", items: f.finishLevels.map((l) => ({ text: `Level ${l.level}${l.where ? ` · ${l.where}` : ""}`, quote: l.quote })) },
        { label: "Products", items: f.products.map((p) => ({ text: [p.manufacturer, p.product].filter(Boolean).join(" · "), quote: p.quote })) },
      ].filter((g) => g.items.length > 0)
    : [];
  return (
    <li className="flex flex-col gap-2 p-3" data-spec="section" data-number={section.sectionNumber} data-read={section.reading ? "yes" : "no"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-body">
          <span className="font-medium text-ink">{section.sectionNumber}</span>
          {section.title ? ` ${section.title}` : ""}
          {section.pages && <span className="text-xs text-ink-muted"> · pages {section.pages}</span>}
          {section.reading && <span className="text-xs text-ink-muted"> · read {section.reading.on}</span>}
        </p>
        <button type="button" className={btn} disabled={busy} onClick={() => void onRead()} data-spec="read">
          {section.reading ? "Read again" : "Read it"}
        </button>
      </div>
      {f && facts.length === 0 && f.priceDrivers.length === 0 && (
        <p className="text-xs text-ink-muted">Nothing for your trade found in this section. {f.reason}</p>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
          {facts.map((g) => (
            <div key={g.label} className="contents">
              <dt className="text-xs font-semibold text-ink-label">{g.label}</dt>
              <dd className="flex flex-col">
                {g.items.map((i) => (
                  <span key={i.text + i.quote} className="text-ink-body" title={`“${i.quote}”`} data-spec="fact">
                    {i.text}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {f && f.priceDrivers.length > 0 && section.reading && (
        <div className="flex flex-col gap-1" data-spec="drivers">
          <p className="text-xs font-semibold text-ink-label">Changes the price</p>
          {f.priceDrivers.map((d, index) => (
            <Driver key={d.label + index} readingId={section.reading!.id} index={index} label={d.label} why={d.why} quote={d.quote} />
          ))}
        </div>
      )}
    </li>
  );
}

function Driver({ readingId, index, label, why, quote }: { readingId: string; index: number; label: string; why: string; quote: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const add = (kind: "INCLUSION" | "ALTERNATE") =>
    start(async () => {
      const result = await addSpecDriverToProposal(readingId, index, kind).catch(() => ({ ok: false as const, error: "That did not go through." }));
      setNote(result.ok ? (kind === "INCLUSION" ? "Added to the proposal's inclusions." : "Added to the proposal as an alternate.") : result.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-spec="driver">
      <span className="text-ink" title={`“${quote}”`}>
        {label}
      </span>
      <span className="text-xs text-ink-muted">{why}</span>
      <span className="ml-auto flex gap-2">
        <button type="button" className={btn} disabled={pending} onClick={() => add("INCLUSION")} data-spec="add-inclusion">
          Add as inclusion
        </button>
        <button type="button" className={btn} disabled={pending} onClick={() => add("ALTERNATE")} data-spec="add-alternate">
          Add as alternate
        </button>
      </span>
      {note && <span className="w-full text-xs text-ink-body" data-spec="driver-note">{note}</span>}
    </div>
  );
}
