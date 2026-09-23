"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchApp } from "@/lib/actions";
import { runSearch } from "@/lib/search/panel";
import { SEARCH_TYPE_LABELS } from "@/lib/search/types";
import type { SearchRecordResult, SearchPageResult } from "@/lib/search/types";

/**
 * The safety net this app's growing feature count needs: one box that
 * finds anything — a job, an RFI, a vendor — OR the PAGE that does
 * something, so a feature can be taken off the sidebar without taking it
 * out of reach. See lib/search/query.ts for what actually decides what
 * comes back; this file is presentation and the keyboard.
 *
 * MOUNTED IN Topbar, same as AskLauncher and HelpButton beside it, so the
 * shortcut and the button both work from every page. Cmd+K on a Mac,
 * Ctrl+K everywhere else — the platform-conventional binding almost every
 * search-first product uses, chosen over inventing one so it needs no
 * teaching.
 *
 * WHAT THIS COMPONENT DOES NOT DECIDE: which records or pages a person can
 * see. Every row it renders already passed a capability check server-side,
 * in `globalSearch` — this component only ever renders what the Server
 * Action handed back for the signed-in caller. There is no client-side
 * filtering here to get wrong.
 */

type FlatEntry =
  | { kind: "page"; result: SearchPageResult }
  | { kind: "record"; result: SearchRecordResult };

const DEBOUNCE_MS = 150;
const MIN_QUERY_LENGTH = 2;

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent ?? "");
}

/** Records grouped by type, in first-seen order — the order
 * `SEARCH_PROVIDERS` ran in, which `globalSearch` never reshuffles. */
function groupRecords(records: SearchRecordResult[]): { type: string; label: string; rows: SearchRecordResult[] }[] {
  const order: string[] = [];
  const byType = new Map<string, SearchRecordResult[]>();
  for (const record of records) {
    if (!byType.has(record.type)) {
      byType.set(record.type, []);
      order.push(record.type);
    }
    byType.get(record.type)!.push(record);
  }
  return order.map((type) => ({ type, label: SEARCH_TYPE_LABELS[type] ?? type, rows: byType.get(type)! }));
}

export function SearchLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<SearchPageResult[]>([]);
  const [records, setRecords] = useState<SearchRecordResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const groups = useMemo(() => groupRecords(records), [records]);
  const flat: FlatEntry[] = useMemo(
    () => [
      ...pages.map((result): FlatEntry => ({ kind: "page", result })),
      ...groups.flatMap((group) => group.rows.map((result): FlatEntry => ({ kind: "record", result }))),
    ],
    [pages, groups],
  );
  // One pass over the same two pieces that built `flat`, so a section's
  // start index can never disagree with where its rows actually landed —
  // no second lookup that could drift from it.
  const sections = useMemo(() => {
    const out: { heading: string; startIndex: number; rows: { key: string; title: string; subtitle: string | null; href: string }[] }[] = [];
    let cursor = 0;
    if (pages.length > 0) {
      out.push({
        heading: "Pages",
        startIndex: cursor,
        rows: pages.map((p) => ({ key: p.route, title: p.title, subtitle: null, href: p.href })),
      });
      cursor += pages.length;
    }
    for (const group of groups) {
      out.push({
        heading: group.label,
        startIndex: cursor,
        rows: group.rows.map((r) => ({ key: r.id, title: r.title, subtitle: r.subtitle, href: r.href })),
      });
      cursor += group.rows.length;
    }
    return out;
  }, [pages, groups]);

  // The global shortcut — works from anywhere, open or not, the same
  // reason AskLauncher mounts in Topbar rather than on one page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Escape and outside-click close, same as AskLauncher.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      // Cleared on close, not on every keystroke — reopening the box with
      // last time's results still on screen for a beat is more confusing
      // than an empty box for the instant before the first debounce fires.
      setQuery("");
      setPages([]);
      setRecords([]);
      setError(null);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setPages([]);
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      // Through `runSearch`, which cannot reject. This callback is a
      // FLOATING promise — `setTimeout` does not await it — so a rejection
      // here is an unhandled rejection, and every line below it,
      // `setLoading(false)` first among them, simply never runs. That is
      // what left the panel reading "Searching…" until it was closed, for
      // any cause at all. See lib/search/panel.ts.
      const result = await runSearch(() => searchApp(trimmed));
      // A slower, earlier request landing after a faster, later one must
      // not overwrite it — the classic race in anything typed-as-you-go.
      if (id !== requestId.current) return;
      setLoading(false);
      if (result.ok) {
        setPages(result.value.pages);
        setRecords(result.value.records);
        setError(null);
      } else {
        setError(result.error);
        setPages([]);
        setRecords([]);
      }
      setActiveIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function openEntry(entry: FlatEntry | undefined) {
    if (!entry) return;
    router.push(entry.result.href);
    setOpen(false);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openEntry(flat[activeIndex]);
    }
  }

  const shortcutLabel = isMac() ? "⌘K" : "Ctrl K";
  const trimmedQuery = query.trim();
  const showEmpty =
    !loading && !error && trimmedQuery.length >= MIN_QUERY_LENGTH && pages.length === 0 && records.length === 0;

  return (
    <div ref={holder} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Search — jobs, contacts, RFIs and every page in the app"
        data-search-launcher
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-body hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <span
          aria-hidden="true"
          className="hidden rounded border border-line-card px-1.5 py-0.5 text-[0.65rem] font-normal text-ink-muted sm:inline"
        >
          {shortcutLabel}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Search"
          // Same viewport-fixed, width-capped shape as AskLauncher's panel
          // beside it — a lookup box, not a takeover, and never wider than
          // the phone it might be opened on.
          className="fixed left-1/2 top-14 z-50 max-h-[calc(100dvh-4.5rem)] w-[min(34rem,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-line-card bg-surface shadow-2xl sm:left-auto sm:right-4 sm:translate-x-0"
        >
          <div className="border-b border-line-card p-3">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search jobs, contacts, RFIs, punch list, pages…"
              aria-label="Search"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="global-search-results"
              className="w-full rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
          <div id="global-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
            {trimmedQuery.length < MIN_QUERY_LENGTH ? (
              <p className="px-2 py-3 text-sm text-ink-muted">Keep typing — at least 2 characters.</p>
            ) : loading ? (
              <p className="px-2 py-3 text-sm text-ink-muted">Searching…</p>
            ) : error ? (
              <p className="px-2 py-3 text-sm text-red-400">{error}</p>
            ) : showEmpty ? (
              <p className="px-2 py-3 text-sm text-ink-muted">Nothing found for &ldquo;{trimmedQuery}&rdquo;.</p>
            ) : (
              sections.map((section) => (
                <ResultGroup
                  key={section.heading}
                  heading={section.heading}
                  rows={section.rows}
                  startIndex={section.startIndex}
                  activeIndex={activeIndex}
                  onHover={setActiveIndex}
                  onSelect={(index) => openEntry(flat[index])}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResultGroup({
  heading,
  rows,
  startIndex,
  activeIndex,
  onHover,
  onSelect,
}: {
  heading: string;
  rows: { key: string; title: string; subtitle: string | null; href: string }[];
  startIndex: number;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="mb-1">
      <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{heading}</p>
      {rows.map((row, i) => {
        const index = startIndex + i;
        const active = index === activeIndex;
        return (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={active}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(index)}
            className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm ${
              active ? "bg-rail-hover text-ink" : "text-ink-body hover:bg-rail-hover hover:text-ink"
            }`}
          >
            <span className="font-medium">{row.title}</span>
            {row.subtitle ? <span className="text-xs text-ink-muted">{row.subtitle}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
