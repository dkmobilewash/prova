"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AreaView } from "@/lib/areas";
import { AreaIcon, StatusChip, StatusLine, ToolIcon } from "./AreaParts";

/**
 * The six area boxes under the home greeting (Concept H): "small boxes on
 * the front page for where everything is, click one and a dropdown goes to
 * another page with all the stuff that feature uses."
 *
 * Desktop: each box is a button (aria-expanded) that opens ONE dropdown at
 * a time listing the area's tools, ending in "Open <Area> →". Esc, a click
 * outside, or a click on the same box closes it; Esc puts focus back on the
 * box. Phone: two-column tiles that go straight to the area page — a
 * dropdown under a thumb is a second tap for nothing.
 *
 * Every figure arrives in `areas`, already filtered by capability
 * (lib/areas.ts `areasFor`) and filled from real rows (lib/areas-data.ts).
 */
/** Space kept between a panel and the edge of the window. */
const EDGE = 16;
/** The panel's `mt-3`. */
const GAP = 12;
/** Below this the panel would be a slot, not a list; it then scrolls the page instead. */
const MIN_HEIGHT = 240;

/**
 * Where an open panel goes, from its box and the window — pure, so it is
 * tested without layout (areas.render.test.tsx); the numbers come from real
 * Chromium at runtime.
 *
 * Left-aligned under its OWN box. If that would run off the right edge it
 * flips to right-aligned with the box, and if even that runs off the left
 * edge it is pinned EDGE px in — never off-screen. Until 2026-10-10 the
 * alignment was by column index ("the right-hand three open leftwards"),
 * which put Paperwork's 640px panel far to the left of Paperwork.
 *
 * `left` is relative to the box. `maxHeight` is what fits between the box
 * and the bottom of the window; a taller list scrolls inside the panel.
 */
export function placePanel(
  box: { left: number; right: number; bottom: number },
  panelWidth: number,
  viewport: { width: number; height: number },
): { left: number; maxHeight: number } {
  let left = 0;
  if (box.left + panelWidth > viewport.width - EDGE) left = box.right - box.left - panelWidth;
  left = Math.max(left, EDGE - box.left);
  const maxHeight = Math.max(MIN_HEIGHT, Math.floor(viewport.height - box.bottom - GAP - EDGE));
  return { left, maxHeight };
}

export function AreaBoxes({ areas }: { areas: AreaView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; maxHeight: number } | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // Measured before paint, so the panel is never seen in the wrong place,
  // and again when the window changes size under an open panel.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const box = buttons.current.get(open)?.getBoundingClientRect();
      const width = panel.current?.offsetWidth ?? 0;
      if (!box) return;
      setPlace(
        placePanel(box, width, { width: document.documentElement.clientWidth, height: window.innerHeight }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      buttons.current.get(open)?.focus();
      setOpen(null);
    };
    const onDown = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (areas.length === 0) return null;

  return (
    <>
      {/* Desktop and tablet: boxes with a dropdown. */}
      <div ref={holder} className="relative z-30 mt-5 hidden grid-cols-3 gap-3 md:grid xl:grid-cols-6" data-home="areas">
        {areas.map((area) => {
          const isOpen = open === area.slug;
          const panelId = `area-panel-${area.slug}`;
          // The other boxes dim while one is open, but stay readable: at 50%
          // their status lines measured 2.4–3.5:1 (both themes); at 85% the
          // lowest is 4.86:1 — "$… owed" in danger red on dark.
          return (
            <div key={area.slug} className={`relative h-full ${open && !isOpen ? "opacity-[0.85]" : ""}`}>
              <button
                ref={(el) => {
                  if (el) buttons.current.set(area.slug, el);
                  else buttons.current.delete(area.slug);
                }}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : area.slug)}
                className={`relative flex h-full w-full flex-col items-stretch justify-start rounded-[14px] border bg-surface px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  isOpen ? "border-brand shadow-[0_0_0_1px_rgb(var(--c-brand))]" : "border-line-card hover:border-ink-muted/60"
                }`}
              >
                <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-rail-hover text-ink">
                  <AreaIcon paths={area.icon} />
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  className={`absolute right-3.5 top-3.5 h-[18px] w-[18px] motion-safe:transition-transform ${isOpen ? "rotate-180 text-link" : "text-ink-muted"}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="mt-2 block font-headline text-lg leading-tight text-ink">{area.name}</span>
                <StatusLine status={area.line} fallback={area.description} className="mt-1" />
              </button>

              {isOpen && (
                <div
                  ref={panel}
                  id={panelId}
                  role="region"
                  aria-label={`${area.name} tools`}
                  data-area-panel={area.slug}
                  style={{ left: place?.left ?? 0, maxHeight: place?.maxHeight }}
                  className="absolute top-full z-40 mt-3 w-[min(640px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-line-card bg-surface p-3 shadow-2xl"
                >
                  <div className="flex items-baseline justify-between px-4 pb-2 pt-1.5">
                    <span className="text-sm font-semibold uppercase tracking-wider text-ink-body">{area.name}</span>
                    <span className="text-sm text-ink-muted">
                      {area.tools.length} {area.tools.length === 1 ? "tool" : "tools"}
                    </span>
                  </div>
                  <ul>
                    {area.tools.map((tool) => (
                      <li key={tool.href}>
                        <Link href={tool.href} className="flex items-center gap-3.5 rounded-xl px-4 py-3 hover:bg-rail-hover focus-visible:bg-rail-hover focus-visible:outline-none">
                          <ToolIcon route={tool.route} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-ink">{tool.name}</span>
                            <span className="block truncate text-sm text-ink-muted" title={tool.description}>{tool.description}</span>
                          </span>
                          {tool.status && <StatusChip status={tool.status} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 border-t border-line-row px-4 pb-1.5 pt-3">
                    <Link href={area.href} className="inline-flex min-h-11 items-center font-semibold text-link hover:text-link-hover hover:underline">
                      Open {area.name} &rarr;
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* The rest of the page dims while a dropdown is open, as in the mockup. */}
      {open && <div aria-hidden className="fixed inset-0 z-20 hidden bg-canvas/60 md:block" />}

      {/* Phone: tiles straight to the area page. */}
      <nav aria-label="Areas" className="mt-4 grid grid-cols-2 gap-2.5 md:hidden" data-home="area-tiles">
        {areas.map((area) => (
          <Link key={area.slug} href={area.href} className="relative flex min-h-[104px] flex-col rounded-[18px] border border-line-card bg-surface px-4 pb-3 pt-3.5 hover:border-ink-muted/60 active:bg-rail-hover">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-rail-hover text-ink">
              <AreaIcon paths={area.icon} className="h-[22px] w-[22px]" />
            </span>
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="absolute right-3.5 top-4 h-5 w-5 text-ink-muted">
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="mt-auto block pt-2 text-[18px] font-semibold leading-tight text-ink">{area.name}</span>
            <StatusLine status={area.line} fallback={area.description} className="mt-1 !text-[14px]" />
          </Link>
        ))}
      </nav>
    </>
  );
}
