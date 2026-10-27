"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type TreeGroup, type TreeSheet, buildSheetTree, printedScaleOffers, takeoffProgress } from "@/lib/takeoff/sheetTree";
import { applyPrintedScales } from "@/lib/actions";
import type { SheetRow } from "@/lib/plan-ingest/sheetIndex";

/**
 * ── WHICH OF THE 175 SHEETS YOU WANT ──
 *
 * The flat pager this replaces was measured at TWENTY presses of Next to reach
 * `A-101` on a 52-sheet set, every one of them blind because the pager reads
 * "Sheet 23 of 52" — a position in a file, not a sheet's own number.
 *
 * The grouping, filtering and status rules are in `lib/takeoff/sheetTree.ts`
 * and tested there; this file is the pixels. It holds exactly one piece of
 * logic of its own — when to spend a PDF render on a thumbnail — because that
 * is a question about the viewport and nothing else can answer it.
 */

type Props = {
  jobId: string;
  planId: string;
  /**
   * The plan-text opt-in. On, the rail ranks the floor plans still needing a
   * scale first, names the printed scale on each sheet's chip, and offers to
   * set every sheet that prints the same scale in one press. Off, the rail is
   * page order and the chip says "confirm", as before.
   */
  scaleHelp: boolean;
  rows: readonly SheetRow[];
  calibratedPages: ReadonlySet<number>;
  printedScaleByPage: Readonly<Record<number, string | null | undefined>>;
  measurementCountByPage: Readonly<Record<number, number>>;
  currentPage: number;
  onPick: (pageNumber: number) => void;
  bookmarks: ReadonlySet<number>;
  onToggleBookmark: (pageNumber: number) => void;
};

/** How wide a thumbnail is rendered, in CSS pixels. */
const THUMB_WIDTH = 72;

/**
 * ── THE THUMBNAIL CACHE, AND WHY IT IS A SECOND PDF DOCUMENT ──
 *
 * The viewer owns the document it is drawing from, and reaching into it from
 * here would couple two components so that neither can be read alone. So the
 * tree opens its own.
 *
 * **That is not a second download.** pdf.js fetches by HTTP RANGE, so a
 * document opened for thumbnails pulls the pages it is asked for and nothing
 * else — which is the same mechanism that inventories a 342 MB set in 2.5
 * seconds rather than downloading it. A `Map` keyed by page number means each
 * sheet is rendered once per session.
 *
 * Renders are SERIALISED through one promise chain. pdf.js will happily accept
 * forty concurrent render calls and then service them on one worker, which
 * turns a scroll into a forty-deep queue that is still draining after the user
 * has gone somewhere else.
 */
function useThumbnails(planId: string, enabled: boolean) {
  const [, bump] = useState(0);
  const cache = useRef(new Map<number, string>());
  const wanted = useRef(new Set<number>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry; same as TakeoffPlanViewer.
  const doc = useRef<Promise<any> | null>(null);

  useEffect(() => {
    // A new plan set is a new document and new pictures.
    cache.current = new Map();
    wanted.current = new Set();
    doc.current = null;
  }, [planId]);

  function request(pageNumber: number) {
    if (!enabled) return;
    if (cache.current.has(pageNumber) || wanted.current.has(pageNumber)) return;
    wanted.current.add(pageNumber);

    chain.current = chain.current
      .then(async () => {
        if (!doc.current) {
          doc.current = (async () => {
            const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              "pdfjs-dist/legacy/build/pdf.worker.mjs",
              import.meta.url,
            ).toString();
            // `credentials: omit` for the reason the viewer states at length:
            // a credentialed cross-origin request is refused against Blob's
            // `*`, which turns a readable file into an unreadable one.
            return pdfjs.getDocument({ url: `/api/takeoff/plan/${planId}` }).promise;
          })();
        }
        const pdf = await doc.current;
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) return;
        await page.render({ canvasContext: context, viewport }).promise;
        cache.current.set(pageNumber, canvas.toDataURL("image/png"));
        bump((n) => n + 1);
      })
      .catch(() => {
        // A thumbnail that will not draw is a thumbnail-shaped blank, never an
        // error: the sheet is still openable, and the page it belongs to is
        // the one that matters. Dropped from `wanted` so a later scroll past
        // it can try again.
        wanted.current.delete(pageNumber);
      });
  }

  return { get: (pageNumber: number) => cache.current.get(pageNumber), request };
}

/** The scale chip's three states, said in words rather than only in colour. */
function ScaleChip({ sheet, named }: { sheet: TreeSheet; named: boolean }) {
  if (sheet.scaleStatus === "set") {
    return (
      <span className="rounded bg-tag-green px-1 py-px text-[10px] font-medium text-tag-green-ink" title="Scale set">
        scale set
      </span>
    );
  }
  if (sheet.scaleStatus === "confirm") {
    return (
      <span
        className="rounded bg-tag-amber px-1 py-px text-[10px] font-medium text-tag-amber-ink"
        title={`The sheet prints ${sheet.printedScale}. Confirm it against a dimension before measuring.`}
        data-takeoff="printed-scale-chip"
      >
        {named ? `${sheet.printedScale} printed` : "confirm"}
      </span>
    );
  }
  return (
    <span
      className="rounded bg-rail px-1 py-px text-[10px] font-medium text-ink-muted"
      title="No scale yet — set one against a printed dimension"
    >
      no scale
    </span>
  );
}

function SheetButton({
  sheet,
  current,
  named,
  thumb,
  onPick,
  onToggleBookmark,
  onVisible,
}: {
  sheet: TreeSheet;
  current: boolean;
  named: boolean;
  thumb: string | undefined;
  onPick: () => void;
  onToggleBookmark: () => void;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);

  // THE ONE PIECE OF LOGIC THIS FILE OWNS: a thumbnail costs a PDF render, so
  // it is spent only on a row somebody can actually see. On a 175-sheet set
  // the difference is two renders and a hundred and seventy-three not taken.
  useEffect(() => {
    const node = ref.current;
    if (!node || thumb) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisible();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumb, onVisible]);

  return (
    <li ref={ref} data-takeoff="tree-sheet" data-page={sheet.pageNumber}>
      <div
        className={
          "group flex items-start gap-2 rounded-md px-2 py-1.5" +
          (current ? " bg-tag-brand-soft" : " hover:bg-rail")
        }
      >
        <button
          type="button"
          onClick={onPick}
          aria-current={current ? "true" : undefined}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span
            className="flex h-12 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded border border-line-card bg-surface"
            aria-hidden
          >
            {thumb ? (
              <img src={thumb} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[10px] text-ink-muted">{sheet.pageNumber}</span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1">
              <span className="truncate text-xs font-semibold text-ink">
                {sheet.sheetNumber ?? `Page ${sheet.pageNumber}`}
              </span>
              {sheet.itemCount > 0 && (
                <span
                  className="shrink-0 rounded bg-tag-brand-soft px-1 text-[10px] font-medium text-tag-brand-soft-ink"
                  title={`${sheet.itemCount} measurement${sheet.itemCount === 1 ? "" : "s"} on this sheet`}
                >
                  {sheet.itemCount}
                </span>
              )}
            </span>
            <span className="block truncate text-[11px] text-ink-body">{sheet.title ?? "—"}</span>
            <span className="mt-0.5 flex items-center gap-1">
              <ScaleChip sheet={sheet} named={named} />
              {sheet.isScan && (
                <span className="rounded bg-rail px-1 py-px text-[10px] text-ink-muted" title="No text layer">
                  scan
                </span>
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleBookmark}
          aria-pressed={sheet.bookmarked}
          aria-label={sheet.bookmarked ? "Remove bookmark" : "Bookmark this sheet"}
          data-takeoff="bookmark"
          className={
            "shrink-0 rounded px-1 text-sm leading-none" +
            (sheet.bookmarked ? " text-link" : " text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100")
          }
        >
          {sheet.bookmarked ? "★" : "☆"}
        </button>
      </div>
    </li>
  );
}

export function TakeoffSheetTree({
  jobId,
  planId,
  scaleHelp,
  rows,
  calibratedPages,
  printedScaleByPage,
  measurementCountByPage,
  currentPage,
  onPick,
  bookmarks,
  onToggleBookmark,
}: Props) {
  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const thumbs = useThumbnails(planId, true);

  const groups: TreeGroup[] = useMemo(
    () =>
      buildSheetTree({
        rows,
        calibratedPages,
        printedScaleByPage,
        measurementCountByPage,
        bookmarks,
        search,
        onlyMine,
        rankPlans: scaleHelp,
      }),
    [rows, calibratedPages, printedScaleByPage, measurementCountByPage, bookmarks, search, onlyMine, scaleHelp],
  );

  const progress = useMemo(() => takeoffProgress(groups), [groups]);
  const offers = useMemo(() => (scaleHelp ? printedScaleOffers(groups) : []), [groups, scaleHelp]);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  async function applyEverywhere(scale: string, pages: number[]) {
    setApplying(scale);
    setApplied(null);
    try {
      const result = await applyPrintedScales(jobId, planId, pages);
      if (!result.ok) {
        setApplied(result.error);
        return;
      }
      const { applied: done, skipped } = result.value;
      const skippedText =
        skipped.length === 0 ? "" : ` · skipped ${skipped.map((s) => `page ${s.pageNumber} (${s.why})`).join(", ")}`;
      setApplied(`Scale set on ${done.length} sheet${done.length === 1 ? "" : "s"} from ${scale}${skippedText}`);
    } catch {
      setApplied("The scales didn't save. Reload and try again.");
    } finally {
      setApplying(null);
    }
  }
  const found = groups.reduce((total, group) => total + group.sheets.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-takeoff="sheet-tree">
      <div className="shrink-0 border-b border-line-card p-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a sheet"
          aria-label="Find a sheet by number or title"
          data-takeoff="sheet-search"
          className="w-full rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-muted"
        />
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-body">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
            data-takeoff="only-mine"
            className="h-3.5 w-3.5"
          />
          Only sheets I&rsquo;ve started or bookmarked
        </label>
        <p className="mt-1.5 text-[11px] text-ink-muted" data-takeoff="tree-progress">
          {progress.started} of {progress.sheets} started · {progress.needScale} need a scale
          {scaleHelp &&
            progress.plansToScale > 0 &&
            ` · ${progress.plansToScale} floor plan${progress.plansToScale === 1 ? "" : "s"} to scale, listed first`}
        </p>
        {/* ── EVERY SHEET THAT PRINTS THE SAME SCALE, IN ONE PRESS ──
            Each sheet is set from ITS OWN reading — the line the inventory
            anchored and the feet it declared — never from a figure typed here.
            A sheet the inventory could not read keeps its "no scale". */}
        {offers.map((offer) => (
          <button
            key={offer.scale}
            type="button"
            disabled={applying !== null}
            onClick={() => void applyEverywhere(offer.scale, offer.pages)}
            data-takeoff="use-printed-scale-everywhere"
            data-scale={offer.scale}
            title={`Set the scale on page${offer.pages.length === 1 ? "" : "s"} ${offer.pages.join(", ")} from what each sheet prints.`}
            className="mt-1.5 block w-full rounded-md border border-line-card px-2 py-1 text-left text-[11px] text-link hover:bg-rail disabled:opacity-60"
          >
            {applying === offer.scale
              ? "Setting…"
              : `Use ${offer.scale} on ${offer.pages.length} sheet${offer.pages.length === 1 ? " that prints it" : "s that print it"}`}
          </button>
        ))}
        {applied !== null && (
          <p className="mt-1 text-[11px] text-ink-body" role="status" data-takeoff="printed-scales-applied">
            {applied}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {found === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-muted" data-takeoff="tree-empty">
            {search.trim() || onlyMine
              ? "No sheet matches that."
              : "No sheets have been read yet. The drawing still opens."}
          </p>
        ) : (
          groups.map((group) => (
            // Native <details>: it works before hydration, it is
            // keyboard-operable for free, and a screen reader already
            // announces it. Open by default — a collapsed tree on arrival is
            // a second click before anybody can do anything.
            <details key={group.key} open className="mb-1" data-takeoff="tree-group" data-key={group.key}>
              <summary className="cursor-pointer px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-label">
                {group.name}
                <span className="ml-1 font-normal normal-case text-ink-muted">{group.sheets.length}</span>
              </summary>
              <ul>
                {group.sheets.map((sheet) => (
                  <SheetButton
                    key={sheet.pageNumber}
                    sheet={sheet}
                    named={scaleHelp}
                    current={sheet.pageNumber === currentPage}
                    thumb={thumbs.get(sheet.pageNumber)}
                    onPick={() => onPick(sheet.pageNumber)}
                    onToggleBookmark={() => onToggleBookmark(sheet.pageNumber)}
                    onVisible={() => thumbs.request(sheet.pageNumber)}
                  />
                ))}
              </ul>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
