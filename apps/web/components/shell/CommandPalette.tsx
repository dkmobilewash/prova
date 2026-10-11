"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OPEN_SEARCH_EVENT } from "@/components/shell/SearchTrigger";
import { Spinner } from "@/components/Spinner";
import {
  buildSections,
  highlight,
  type PaletteAction,
  type PaletteEntry,
  type PaletteResponse,
  SEARCH_UNAVAILABLE,
} from "@/lib/search/palette";

/**
 * "Search or ask" — the way to reach everything now that there is no
 * sidebar. Mounted ONCE by the app shell. Opens on ⌘K / Ctrl+K, and on the
 * `cstream:open-search` event any trigger dispatches.
 *
 * WHAT THIS FILE DOES NOT DECIDE: which records, actions or pages a person
 * may see. GET /api/search answers from the session's own company and
 * capabilities (lib/search/query.ts, palette.ts); this renders what it got.
 */

const DEBOUNCE_MS = 150;

const FOCUSABLE = 'input, button:not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])';

async function fetchPalette(query: string, signal: AbortSignal): Promise<PaletteResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as PaletteResponse;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PaletteAction | null>(null);
  /** The empty-query answer (recent jobs, actions, every page), fetched
   * once per opening and kept while typing, so Actions and Pages filter
   * instantly with no round trip. */
  const [base, setBase] = useState<PaletteResponse | null>(null);
  const [found, setFound] = useState<PaletteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback((prefill: string) => {
    if (!(document.activeElement instanceof HTMLElement) || !dialogRef.current?.contains(document.activeElement)) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setQuery(prefill);
    setPending(null);
    setActive(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setPending(null);
    setFound(null);
    setError(null);
    setLoading(false);
    const target = returnFocus.current;
    returnFocus.current = null;
    // After the dialog is gone, so focus is not handed to a node mid-unmount.
    requestAnimationFrame(() => target?.focus());
  }, []);

  // The shortcut and the event, from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) close();
        else show("");
      }
    };
    const onOpen = (e: Event) => show(String((e as CustomEvent<{ query?: string }>).detail?.query ?? ""));
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, [open, show, close]);

  // On open: focus the box, and fetch the empty-query answer.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const controller = new AbortController();
    fetchPalette("", controller.signal)
      .then(setBase)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error && err.message === "401" ? "Sign in again to search." : SEARCH_UNAVAILABLE);
      });
    return () => controller.abort();
  }, [open]);

  // Typing: debounced, the previous request aborted, and the input never
  // waits on any of it.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setFound(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchPalette(trimmed, controller.signal)
        .then((data) => {
          setFound(data);
          setError(null);
          setLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setError(SEARCH_UNAVAILABLE);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  // Server records for the typed query, laid over the base answer's static
  // lists. Until the first answer for this query lands, the typed view
  // shows only what can be matched locally (actions, pages).
  const data: PaletteResponse | null = useMemo(() => {
    if (!base) return null;
    if (query.trim().length < 2 || !found) return { ...base, records: [], pages: [] };
    return { ...base, records: found.records, pages: found.pages };
  }, [base, found, query]);

  const sections = useMemo(() => buildSections(data, query, pending), [data, query, pending]);
  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  useEffect(() => setActive(0), [query, pending]);
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(flat.length - 1, 0));
  }, [active, flat.length]);
  useEffect(() => {
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function choose(entry: PaletteEntry | undefined) {
    if (!entry) return;
    if (entry.pick) {
      setPending(entry.pick);
      setQuery("");
      inputRef.current?.focus();
      return;
    }
    if (entry.href) {
      returnFocus.current = null; // navigating away — the trigger is not where the user is going
      router.push(entry.href);
      close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (pending) setPending(null);
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter" && e.target === inputRef.current) {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Backspace" && pending && query === "" && e.target === inputRef.current) {
      setPending(null);
    } else if (e.key === "Tab") {
      // Focus trap: Tab cycles inside the dialog and never reaches the page.
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const i = nodes.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? nodes.length - 1 : i - 1) : i === nodes.length - 1 ? 0 : i + 1;
      e.preventDefault();
      nodes[next].focus();
    }
  }

  if (!open) return null;

  const trimmed = query.trim();
  const nothingFound = trimmed.length >= 2 && found !== null && !loading && flat.length === 0;
  let index = -1;

  return (
    <div className="fixed inset-0 z-[60] print:hidden" data-command-palette>
      {/* The scrim. A click on it closes; it is not focusable, Esc is the keyboard way out. */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search or ask"
        onKeyDown={onKeyDown}
        className="relative mx-auto mt-2 flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-2rem)] max-w-[46rem] flex-col gap-3 sm:mt-[9vh] sm:max-h-[82vh]"
      >
        <div className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-brand bg-surface px-4 shadow-[0_0_0_4px_rgb(var(--c-brand)/0.15)] sm:min-h-[60px] sm:px-5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[22px] w-[22px] shrink-0 text-link" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {pending ? (
            <span className="shrink-0 rounded-md bg-tag-brand-soft px-2 py-1 text-sm font-semibold text-tag-brand-soft-ink">{pending.label}</span>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={pending ? "Which job?" : "Search jobs, people, documents, pages — or ask"}
            aria-label={pending ? `${pending.label} — which job?` : "Search or ask"}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={flat.length > 0 ? `palette-opt-${active}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            // focus-visible:ring-0 opts out of globals.css's ring: the 2px
            // brand box around this input IS its focus indicator.
            className="min-w-0 flex-1 bg-transparent text-lg text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-0"
          />
          {/* Quiet, and on every width (the footer is hidden on phones). */}
          {loading ? <Spinner className="text-ink-muted" /> : null}
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="shrink-0 rounded-md border border-line-card px-2 py-1 text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            esc
          </button>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line-card bg-surface shadow-2xl">
          <div id="palette-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {error ? (
              <p className="px-3 py-4 text-sm text-danger">{error}</p>
            ) : !base ? (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-ink-muted">
                <Spinner />
                Loading…
              </p>
            ) : nothingFound ? (
              <p className="px-3 py-4 text-sm text-ink-muted">
                Nothing found for &ldquo;{trimmed}&rdquo;.
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.heading} role="group" aria-labelledby={`palette-h-${section.heading}`}>
                  <p
                    id={`palette-h-${section.heading}`}
                    className="px-3 pb-1.5 pt-3 text-xs font-medium uppercase tracking-[0.12em] text-ink-muted"
                  >
                    {section.heading}
                  </p>
                  {section.entries.map((entry) => {
                    index += 1;
                    const i = index;
                    const isActive = i === active;
                    return (
                      <div
                        key={entry.id}
                        id={`palette-opt-${i}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(entry)}
                        className={`flex min-h-11 cursor-pointer items-center gap-3.5 rounded-xl border px-3 py-2 ${
                          isActive ? "border-line-card bg-rail-hover" : "border-transparent"
                        }`}
                      >
                        <EntryIcon entry={entry} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] text-ink">
                            {highlight(entry.title, entry.icon === "ask" || pending ? "" : trimmed).map((run, k) =>
                              run.hit ? (
                                <mark key={k} className="bg-transparent text-link">
                                  {run.text}
                                </mark>
                              ) : (
                                <span key={k}>{run.text}</span>
                              ),
                            )}
                          </p>
                          {entry.subtitle ? <p className="truncate text-sm text-ink-muted">{entry.subtitle}</p> : null}
                        </div>
                        <span className={`shrink-0 text-sm ${isActive ? "text-link" : "text-ink-muted"}`}>
                          {entry.verb}
                          {isActive ? <span aria-hidden="true"> ↵</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="hidden items-center gap-5 border-t border-line-row px-5 py-2.5 text-xs text-ink-muted sm:flex">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span>esc {pending ? "back" : "close"}</span>
            <span className="ml-auto" aria-live="polite">
              {loading ? "Searching…" : trimmed.length >= 2 && found ? `${flat.length} results` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: PaletteEntry }) {
  const base = "grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-sm";
  if (entry.icon === "person") {
    const initials = entry.title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
    return (
      <span aria-hidden="true" className={`${base} border-line-row bg-canvas text-ink-body`}>
        {initials}
      </span>
    );
  }
  if (entry.icon === "action" || entry.icon === "ask") {
    return (
      <span aria-hidden="true" className={`${base} border-brand/40 bg-tag-brand-soft text-tag-brand-soft-ink`}>
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          {entry.icon === "ask" ? (
            <path d="M10 2.5 11.6 7l4.4 1.6L11.6 10 10 14.5 8.4 10 4 8.6 8.4 7 10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          ) : (
            <path d="M11 2.5 4.5 11h5l-1 6.5L15.5 9h-5l.5-6.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          )}
        </svg>
      </span>
    );
  }
  const d =
    entry.icon === "job"
      ? "M4 17V5.5L10 3l6 2.5V17M4 17h12M8 8h1M11 8h1M8 11h1M11 11h1M9 17v-3h2v3"
      : entry.icon === "doc"
        ? "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15M8 10h5M8 13h5"
        : "M3.5 5h13M3.5 10h13M3.5 15h8";
  return (
    <span aria-hidden="true" className={`${base} border-line-row bg-canvas text-ink-muted`}>
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
