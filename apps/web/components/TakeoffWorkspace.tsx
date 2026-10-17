"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Spinner } from "@/components/Spinner";
import { TakeoffPlanViewer } from "@/components/TakeoffPlanViewer";
import { TakeoffAssemblyPanel } from "@/components/TakeoffAssemblyPanel";
import { TakeoffItemProperties } from "@/components/TakeoffItemProperties";
import { TakeoffItemsPanel } from "@/components/TakeoffItemsPanel";
import { TakeoffSheetTree } from "@/components/TakeoffSheetTree";
import { TakeoffSheetSummary } from "@/components/TakeoffSheetSummary";
import { deleteTakeoffMeasurement } from "@/lib/actions";
import {
  EMPTY as EMPTY_UNDO,
  type UndoState,
  canRedo,
  canUndo,
  nextRedoLabel,
  nextUndoLabel,
  pushed,
  redoOnce,
  undoOnce,
} from "@/lib/takeoff/undoStack";
import type { TakeoffWorkspaceData } from "@/lib/takeoff/workspaceLoad";

/**
 * ── THE PLAN, AS LARGE AS THE SCREEN WILL ALLOW ──
 *
 * The takeoff tab puts the drawing inside the app chrome, beside the uploader,
 * the schedule proposals and the measurement list. That is the right page for
 * setting a job up and the wrong one for WORKING a takeoff, which wants every
 * pixel there is.
 *
 * So this is a shell and not a second takeoff. `TakeoffPlanViewer` still owns
 * the tool row, the scale controls, Find the walls, the detected groups and
 * every caution. The shell owns what the viewer cannot know: which job, which
 * sheets exist, the way back, and the keyboard.
 *
 * ── CANVAS FIRST, AT EVERY WIDTH ──
 *
 * One rule — the canvas takes everything the top bar and the OPEN panels do
 * not — and three layouts:
 *
 *   >= 1280   the rails are in the flow, so opening one narrows the canvas and
 *             closing it widens it. Quantities defaults open at 1440 and up
 *             and closed below, because at 1280 a 23rem rail is a third of the
 *             width.
 *   768-1279  both rails are DRAWERS: fixed, over a backdrop, reserving NO
 *             width. The first version used `absolute` and still took its
 *             space out of the row, so the canvas was pushed off its own page
 *             and clipped at both edges. That is why the spec measures overlap
 *             rather than trusting a class name.
 *   < 768     read-only. Every tool places something on the drawing by
 *             clicking it, and 390px cannot be clicked accurately enough to
 *             trace a wall. An estimator on a phone is checking a number, not
 *             measuring one.
 */

type Props = {
  jobId: string;
  jobName: string;
  data: TakeoffWorkspaceData & object;
  savedAt: string;
  openPage: number;
};

const KEYS: { keys: string; does: string }[] = [
  { keys: "[", does: "sheets" },
  { keys: "]", does: "quantities" },
  { keys: "\\", does: "sheet facts" },
  { keys: "f", does: "fit" },
  { keys: "j / k", does: "next / previous sheet" },
  { keys: "b", does: "bookmark this sheet" },
  { keys: "g", does: "overview" },
  { keys: "⌘Z / ⌘⇧Z", does: "undo / redo" },
  { keys: "Esc", does: "close a drawer" },
  { keys: "?", does: "shortcuts" },
];

/**
 * Where the workspace's furniture is remembered.
 *
 * `localStorage`, not the database: CLAUDE.md's rule is that browser storage
 * is for a per-viewer convenience — a remembered tab, a collapsed section —
 * and never for state anybody else reads back. Which rail somebody likes open,
 * and how wide, is exactly that; the alternative is columns on `User` and a
 * migration for a preference.
 *
 * **BOOKMARKS ARE HERE TOO, and that is a decision rather than an oversight.**
 * They are one person's "come back to these four sheets", not a property of
 * the plan set — two estimators on one job want different ones. If they ever
 * need to be shared, that is a model and a migration, and the Phase 0 design
 * says how such a thing is announced.
 */
const KEY = {
  panel: "prova.takeoff.panel",
  sheets: "prova.takeoff.sheets",
  facts: "prova.takeoff.facts",
  railWidth: "prova.takeoff.railWidth",
  summary: "prova.takeoff.summary",
  items: "prova.takeoff.items",
  hidden: (jobId: string) => `prova.takeoff.hidden.${jobId}`,
  bookmarks: (jobId: string) => `prova.takeoff.bookmarks.${jobId}`,
};

/** Below this the rails are drawers rather than part of the flow. */
const RAIL_WIDTH = 1280;
/** At or above this the quantities rail starts open. */
const WIDE = 1440;
/** Below this the workspace is read-only. */
const PHONE = 768;

const RAIL_MIN = 180;
const RAIL_MAX = 420;
const RAIL_DEFAULT = 232;

/** Height of the sheet-facts strip, in rem, when it is open. */
const FACTS_REM = 6.5;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows and blocked site data both throw. A preference that
    // cannot be read is not a reason to render nothing.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The preference still applies to this visit; it just will not survive.
  }
}

export function TakeoffWorkspace({ jobId, jobName, data, savedAt, openPage }: Props) {
  // Width is STATE, not only a media query: a drawer needs to know it is a
  // drawer, and a backdrop that exists only in CSS cannot be closed by Escape.
  const [width, setWidth] = useState<number>(() =>
    typeof window === "undefined" ? WIDE : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const drawers = width < RAIL_WIDTH;
  const phone = width < PHONE;

  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  const [bookmarks, setBookmarks] = useState<ReadonlySet<number>>(new Set());
  const [page, setPage] = useState(openPage);

  /**
   * ── WHICH ITEM IS BEING DRAWN WITH ──
   *
   * Not remembered across visits, deliberately. An item selected yesterday is
   * a condition somebody has stopped thinking about, and arriving with one
   * armed means the first thing they trace lands somewhere they did not
   * choose. Null is Unassigned, which is recoverable; a wrong item is not
   * obviously wrong.
   */
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  /** Items hidden on the drawing. Per-viewer, so localStorage — see KEY. */
  const [hiddenItems, setHiddenItems] = useState<ReadonlySet<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(false);

  // ── THE REMEMBERED FURNITURE, once, on mount ──
  //
  // Not in the initialisers: `localStorage` is not there during the server
  // render, and a first render that disagrees with the second is a hydration
  // mismatch, which this repo has an entire CLAUDE.md entry about.
  useEffect(() => {
    const panel = readStored(KEY.panel);
    if (panel === "open") setPanelOpen(true);
    else if (panel === "closed") setPanelOpen(false);
    else setPanelOpen(window.innerWidth >= WIDE);

    const sheets = readStored(KEY.sheets);
    setSheetsOpen(sheets === null ? window.innerWidth >= RAIL_WIDTH : sheets === "open");
    setFactsOpen(readStored(KEY.facts) === "open");

    const stored = Number(readStored(KEY.railWidth));
    if (Number.isFinite(stored) && stored >= RAIL_MIN && stored <= RAIL_MAX) setRailWidth(stored);

    setSummaryOpen(readStored(KEY.summary) !== "closed");
    // Open by default at rail widths: the items list is what this workspace is
    // FOR, and arriving with it closed hides the feature behind a button.
    const itemsPref = readStored(KEY.items);
    setItemsOpen(itemsPref === null ? window.innerWidth >= RAIL_WIDTH : itemsPref === "open");
    const hide = readStored(KEY.hidden(jobId));
    if (hide) {
      try {
        const parsed: unknown = JSON.parse(hide);
        if (Array.isArray(parsed)) setHiddenItems(new Set(parsed.filter((v) => typeof v === "string")));
      } catch {
        // A corrupt preference is a missing preference.
      }
    }

    const marks = readStored(KEY.bookmarks(jobId));
    if (marks) {
      try {
        const parsed: unknown = JSON.parse(marks);
        if (Array.isArray(parsed)) setBookmarks(new Set(parsed.filter((n) => typeof n === "number")));
      } catch {
        // A corrupt preference is a missing preference.
      }
    }
  }, [jobId]);

  const rememberPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    writeStored(KEY.panel, open ? "open" : "closed");
  }, []);
  const rememberSheets = useCallback((open: boolean) => {
    setSheetsOpen(open);
    writeStored(KEY.sheets, open ? "open" : "closed");
  }, []);
  const rememberItems = useCallback((open: boolean) => {
    setItemsOpen(open);
    writeStored(KEY.items, open ? "open" : "closed");
  }, []);
  const rememberFacts = useCallback((open: boolean) => {
    setFactsOpen(open);
    writeStored(KEY.facts, open ? "open" : "closed");
  }, []);

  const toggleHiddenItem = useCallback(
    (itemId: string) => {
      setHiddenItems((was) => {
        const next = new Set(was);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        writeStored(KEY.hidden(jobId), JSON.stringify([...next]));
        return next;
      });
    },
    [jobId],
  );

  const toggleBookmark = useCallback(
    (pageNumber: number) => {
      setBookmarks((was) => {
        const next = new Set(was);
        if (next.has(pageNumber)) next.delete(pageNumber);
        else next.add(pageNumber);
        writeStored(KEY.bookmarks(jobId), JSON.stringify([...next].sort((a, b) => a - b)));
        return next;
      });
    },
    [jobId],
  );

  // ── RESIZING THE SHEET RAIL ──
  //
  // Pointer events rather than mouse: the same handler then works for a stylus
  // on a tablet, which is the width where a rail matters most. Captured, so a
  // fast drag that leaves the 4px handle does not drop the resize.
  const dragging = useRef(false);
  const onRailDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onRailMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const next = Math.min(RAIL_MAX, Math.max(RAIL_MIN, event.clientX));
    setRailWidth(next);
  }, []);
  const onRailDrop = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      writeStored(KEY.railWidth, String(railWidth));
    },
    [railWidth],
  );

  // ── A SECOND TAB'S SAVE WINS, AND THIS ONE HAS TO SAY SO ──
  //
  // On focus rather than polled: a poll would be a request every few seconds
  // for every open workspace, forever, to answer a question that only matters
  // when somebody comes back to the tab.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/takeoff/${jobId}/saved-at`, { cache: "no-store" });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const latest = typeof body === "object" && body !== null ? (body as { savedAt?: string }).savedAt : null;
        if (!cancelled && typeof latest === "string" && latest !== savedAt) setChangedElsewhere(true);
      } catch {
        // A failed check is not a reason to tell anybody anything.
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [jobId, savedAt]);

  // ── UNDO ──
  //
  // The stack itself is `lib/takeoff/undoStack.ts`, which says why it is a
  // command stack rather than a server journal. This holds it, runs it, and
  // serialises it: `busy` is why two ⌘Z presses cannot race two inverse
  // actions onto one row.
  const [undoState, setUndoState] = useState<UndoState>(EMPTY_UNDO);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onMeasurementSaved = useCallback(
    (saved: { id: string; kind: string }) => {
      const what = saved.kind === "AREA" ? "area" : saved.kind === "COUNT" ? "count" : "line";
      setUndoState((was) =>
        pushed(was, {
          label: `Add ${what}`,
          undo: () => deleteTakeoffMeasurement(jobId, saved.id),
          // REDO IS NOT RE-CREATE, and saying so is better than pretending.
          // The row is gone and a new one would have a new id, which every
          // later entry in the stack would still be pointing past. Phase 2
          // gives the draw tools a real inverse pair; until then a redo
          // refuses in words rather than silently doing nothing.
          redo: async () => ({
            ok: false as const,
            error: "Redrawing is not available yet — draw it again.",
          }),
        }),
      );
    },
    [jobId],
  );

  const runUndo = useCallback(
    async (direction: "undo" | "redo") => {
      if (busy) return;
      setBusy(true);
      try {
        const outcome = direction === "undo" ? await undoOnce(undoState) : await redoOnce(undoState);
        if (!outcome) return;
        setUndoState(outcome.state);
        setToast(
          outcome.result.ok
            ? `${direction === "undo" ? "Undid" : "Redid"}: ${outcome.label}`
            : outcome.result.error,
        );
        // The numbers on screen came from the server; after an undo they are
        // one measurement out of date.
        if (outcome.result.ok) window.location.reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, undoState],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // NEVER while typing: a shortcut that fires inside a scale field eats
      // somebody's dimension.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

      // ⌘Z / ⌘⇧Z are the only modified keys this shell claims.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void runUndo(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        // Escape closes a drawer and nothing else, so it cannot surprise
        // somebody mid-measurement on a desktop, where there are none.
        if (overview) {
          setOverview(false);
          return;
        }
        if (drawers && (sheetsOpen || panelOpen || itemsOpen)) {
          closeDrawers();
        }
        return;
      }
      if (event.key === "[") return rememberSheets(!sheetsOpen);
      if (event.key === "]") return rememberPanel(!panelOpen);
      if (event.key === "\\") return rememberFacts(!factsOpen);
      if (event.key === "?") return setHelpOpen((open) => !open);
      if (event.key === "g") return setOverview((open) => !open);
      if (event.key === "b") return toggleBookmark(page);
      // The rest belong to the viewer, which owns the canvas. Forwarded as an
      // event rather than reached into: this shell has no business holding the
      // viewer's zoom.
      if (["f", "j", "k"].includes(event.key)) {
        document.dispatchEvent(new CustomEvent("takeoff-shortcut", { detail: { key: event.key } }));
      }
    },
    [
      drawers,
      factsOpen,
      overview,
      page,
      panelOpen,
      rememberFacts,
      rememberPanel,
      rememberSheets,
      runUndo,
      sheetsOpen,
      toggleBookmark,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const sheets = data.sheets;
  const calibratedPages = useMemo(
    () => new Set(sheets.filter((sheet) => sheet.calibration !== null).map((sheet) => sheet.pageNumber)),
    [sheets],
  );
  const measurementCountByPage = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const sheet of sheets) counts[sheet.pageNumber] = sheet.measurements.length;
    return counts;
  }, [sheets]);

  /**
   * ── EVERY PAGE OF THE PDF IS A ROW IN THE TREE, read or not ──
   *
   * `sheetRows` comes from `PlanSheetText` + `PlanSheetProposal`, which exist
   * only once INGEST has read a page's title block. The PAGES exist from the
   * moment the file is uploaded.
   *
   * Driving the tree from `sheetRows` alone therefore shows NOTHING on a set
   * whose ingest has not run, has not finished, or failed — while the drawing
   * itself opens perfectly well beside it. Found by the e2e spec, whose blob
   * store is stubbed so ingest cannot run, and confirmed against a real plan:
   * the first screenshot of this workspace on Camp Bow Wow's A102 read
   * "SHEETS (0)" with the sheet plainly on the canvas.
   *
   * So pages lead and rows enrich. A page with no proposal files under "Not
   * filed" and says `Page 9`, which is what somebody can act on; a page whose
   * title block HAS been read gets its number, title and discipline.
   */
  const treeRows = useMemo(() => {
    const byPage = new Map(data.sheetRows.map((row) => [row.pageNumber, row]));
    // THE UNION OF BOTH SOURCES, because NEITHER is complete on its own and
    // they are incomplete in opposite directions.
    //
    // `TakeoffPlanPage` rows are created LAZILY — `saveTakeoffCalibration`
    // upserts one — so a 175-page set nobody has scaled yet has none at all.
    // `sheetRows` covers every page ingest has read, which on a finished
    // ingest is all of them and during one is a growing prefix.
    //
    // Iterating either alone loses sheets: pages-only hides everything
    // unscaled, rows-only hides a page somebody scaled before ingest reached
    // it. The union shows each sheet once, the moment EITHER source knows it
    // exists.
    const pages = new Set<number>([
      ...data.sheetRows.map((row) => row.pageNumber),
      ...sheets.map((sheet) => sheet.pageNumber),
    ]);
    return [...pages]
      .sort((a, b) => a - b)
      .map(
        (pageNumber) => byPage.get(pageNumber) ?? { pageNumber, hasTextLayer: true, proposal: null },
      );
  }, [data.sheetRows, sheets]);

  const items = data.items;
  const activeItem = items.find((item) => item.id === activeItemId) ?? null;
  /**
   * Measurements with no item, counted from the SHEETS rather than from the
   * items: an unassigned measurement is by definition in no item's list, so
   * asking the items would always answer zero.
   */
  const unassignedCount = useMemo(
    () => sheets.reduce((n, sheet) => n + sheet.measurements.filter((m) => m.itemId === null).length, 0),
    [sheets],
  );

  /** Loose geometry on the sheet in front of somebody — see the rail's offer. */
  const unassignedHere = useMemo(
    () =>
      (sheets.find((sheet) => sheet.pageNumber === page)?.measurements ?? [])
        .filter((m) => m.itemId === null || m.itemId === undefined)
        .map((m) => m.id),
    [sheets, page],
  );

  const currentSheet = sheets.find((sheet) => sheet.pageNumber === page) ?? null;
  const currentRow = data.sheetRows.find((row) => row.pageNumber === page) ?? null;

  const excluded = data.sheetRows.filter((row) => {
    const caution = data.duplicateWallsByPage[row.pageNumber];
    return typeof caution === "string" && caution.length > 0;
  });

  const tree = (
    <TakeoffSheetTree
      planId={data.plan.id}
      rows={treeRows}
      calibratedPages={calibratedPages}
      printedScaleByPage={data.printedScaleByPage}
      measurementCountByPage={measurementCountByPage}
      currentPage={page}
      onPick={(pageNumber) => {
        setPage(pageNumber);
        document.dispatchEvent(new CustomEvent("takeoff-goto", { detail: { page: pageNumber } }));
        if (drawers) rememberSheets(false);
      }}
      bookmarks={bookmarks}
      onToggleBookmark={toggleBookmark}
    />
  );

  // Picking an item opens the properties strip, because the properties are the
  // reason to look at it. Closing the strip by hand still sticks: this only
  // fires on a CHANGE of selection, so it cannot fight somebody who shut it.
  useEffect(() => {
    if (activeItemId !== null && !factsOpen) rememberFacts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on selection only; including factsOpen would reopen it the moment it is closed.
  }, [activeItemId]);

  /**
   * ── THE ITEMS RAIL CARRIES THE ASSEMBLY BENEATH THE LIST ──
   *
   * Not a fourth rail. The question "what is this item priced as" is about
   * the item that is selected in the list two inches above, and putting it
   * behind its own toggle would mean opening two panels to answer one
   * question. It takes a third of the rail and only when something is
   * selected.
   */
  const itemsPanel = (
    <TakeoffItemsPanel
      jobId={jobId}
      items={items}
      activeItemId={activeItemId}
      onPick={setActiveItemId}
      currentPage={page}
      hidden={hiddenItems}
      onToggleHidden={toggleHiddenItem}
      unassignedHere={unassignedHere}
      unassignedCount={unassignedCount}
      readOnly={phone}
    />
  );

  const railContents = (
    <div className="flex h-full min-h-0 flex-col">
      <div className={activeItem ? "min-h-0 flex-[2]" : "min-h-0 flex-1"}>{itemsPanel}</div>
      {activeItem && (
        <div className="min-h-0 flex-1 border-t border-line-card">
          <TakeoffAssemblyPanel
            jobId={jobId}
            assemblies={data.assemblies}
            item={activeItem}
            pinnedAt={data.assemblyLibraryPinnedAt}
            readOnly={phone}
          />
        </div>
      )}
    </div>
  );

  const closeDrawers = () => {
    rememberSheets(false);
    rememberPanel(false);
    rememberItems(false);
  };

  return (
    // `--shell-port` IS WHY THE DRAWING IS BIG. The viewer sizes its canvas
    // against it, and the variable is defined on the app shell's <main>; this
    // page is deliberately outside that shell, so it defines its own — the
    // viewport less the identity row and whatever the sheet-facts strip takes.
    // `fill` below does the rest.
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-canvas"
      style={
        {
          "--shell-port": `calc(100dvh - 2.75rem${factsOpen && !phone ? ` - ${FACTS_REM}rem` : ""})`,
        } as React.CSSProperties
      }
      data-takeoff="workspace"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-card bg-surface px-3">
        {!phone && (
          <button
            type="button"
            onClick={() => rememberSheets(!sheetsOpen)}
            aria-expanded={sheetsOpen}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail"
            data-takeoff="toggle-sheets"
          >
            Sheets
          </button>
        )}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold text-ink-label" data-takeoff="workspace-job">
            {jobName}
          </h1>
          {/* WHICH PLAN SET, because a job can have several revisions and a
              measurement taken off the wrong one is wrong quietly. */}
          <span className="hidden truncate text-xs text-ink-muted sm:inline" data-takeoff="plan-set">
            {data.plan.revisionLabel ?? data.plan.fileName ?? "Plan set"}
          </span>
        </div>
        {phone && (
          <span
            className="rounded border border-line-card px-1.5 py-0.5 text-[10px] text-ink-muted"
            data-takeoff="read-only"
          >
            read-only
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* SAVE STATUS. Every edit here is a server action that has already
              returned before the screen changes, so there is no "saving…"
              state to show and inventing one would be a lie. What an estimator
              actually needs to know is that nothing is held locally. */}
          {!phone && (
            <span className="hidden text-[11px] text-ink-muted lg:inline" data-takeoff="save-status">
              {busy ? (
                // KEEP THE WORD — the spinner is aria-hidden, so the word is
                // all a screen reader gets. A label that simply stops changing
                // reads as a crash rather than as work in progress.
                <span className="inline-flex items-center gap-1.5">
                  <Spinner />
                  Working…
                </span>
              ) : (
                "Saved as you go"
              )}
            </span>
          )}
          {!phone && (
            <>
              <div className="flex items-center" data-takeoff="undo-group">
                <button
                  type="button"
                  onClick={() => void runUndo("undo")}
                  disabled={!canUndo(undoState) || busy}
                  title={nextUndoLabel(undoState) ? `Undo: ${nextUndoLabel(undoState)}` : "Nothing to undo"}
                  aria-label="Undo"
                  data-takeoff="undo"
                  className="rounded-l-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail disabled:opacity-40"
                >
                  ↺
                </button>
                <button
                  type="button"
                  onClick={() => void runUndo("redo")}
                  disabled={!canRedo(undoState) || busy}
                  title={nextRedoLabel(undoState) ? `Redo: ${nextRedoLabel(undoState)}` : "Nothing to redo"}
                  aria-label="Redo"
                  data-takeoff="redo"
                  className="-ml-px rounded-r-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail disabled:opacity-40"
                >
                  ↻
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOverview((open) => !open)}
                aria-expanded={overview}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail"
                data-takeoff="toggle-overview"
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setHelpOpen((open) => !open)}
                className="hidden rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail sm:inline-block"
                aria-expanded={helpOpen}
                data-takeoff="toggle-shortcuts"
              >
                Shortcuts
              </button>
              {/* ── EVERY PANEL TOGGLE LIVES HERE ──
                  The sheet-facts one had its own strip along the bottom of
                  the window for about an hour, and the layout assertion
                  caught what that cost: a permanent 22px bar took the canvas
                  from 86% of the viewport to 83.7%, under the floor. A
                  control for a panel that is usually closed must not charge
                  rent on the drawing. */}
              <button
                type="button"
                onClick={() => rememberItems(!itemsOpen)}
                aria-expanded={itemsOpen}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail"
                data-takeoff="toggle-items"
              >
                Items
              </button>
              <button
                type="button"
                onClick={() => rememberFacts(!factsOpen)}
                aria-expanded={factsOpen}
                className="hidden rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail lg:inline-block"
                data-takeoff="toggle-facts"
              >
                Sheet facts
              </button>
              <button
                type="button"
                onClick={() => rememberPanel(!panelOpen)}
                aria-expanded={panelOpen}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail"
                data-takeoff="toggle-panel"
              >
                Quantities
              </button>
            </>
          )}
          <Link
            href={`/jobs/${jobId}/estimate`}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-link hover:text-link-hover"
            data-takeoff="back-to-estimate"
          >
            Back to C&nbsp;Stream
          </Link>
        </div>
      </header>

      {changedElsewhere && (
        <div
          className="shrink-0 border-b border-line-card bg-tag-amber px-3 py-1.5 text-xs text-tag-amber-ink"
          role="status"
          data-takeoff="changed-elsewhere"
        >
          This takeoff changed in another tab or window. Reload to see the current numbers —{" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">
            reload now
          </button>
          .
        </div>
      )}

      {helpOpen && !phone && (
        <div className="shrink-0 border-b border-line-card bg-surface px-3 py-2" data-takeoff="shortcuts">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-body">
            {KEYS.map((entry) => (
              <li key={entry.keys}>
                <kbd className="rounded border border-line-card bg-rail px-1 font-mono">{entry.keys}</kbd>{" "}
                {entry.does}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── The sheet rail, IN THE FLOW only when it is a rail ────────── */}
        {sheetsOpen && !drawers && !phone && (
          <>
            <aside
              className="shrink-0 overflow-hidden border-r border-line-card bg-surface"
              style={{ width: railWidth }}
              data-takeoff="sheet-rail"
            >
              {tree}
            </aside>
            {/* The resize handle. `col-resize` and a real pointer target of
                6px — a 1px border is a hairline nobody can grab. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the sheet list"
              onPointerDown={onRailDrag}
              onPointerMove={onRailMove}
              onPointerUp={onRailDrop}
              onPointerCancel={onRailDrop}
              data-takeoff="rail-resize"
              className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-brand/40"
            />
          </>
        )}

        {/* ── THE CANVAS, FIRST AND ALWAYS ──
            Nothing is layered over it while the drawers are closed, and it
            takes every pixel the bars and the open rails leave. */}
        {/* ── AT TABLET THE VIEWER'S OWN PANEL *IS* THE DRAWER ──
            Not a second panel beside it. The quantities belong to the viewer,
            which renders them from its own state; a copy here would be a
            second answer to "how much wall is there", and the two would drift
            — the shape CLAUDE.md records half a dozen times.
            So the panel is lifted out of the flow by CSS instead: fixed to the
            right, over the backdrop, reserving no width. One surface in two
            positions, and `found-walls` is the viewer's own handle on it. */}
        {/* ── THE ITEMS RAIL ──
            On the right in the flow at >= 1280, and a DRAWER below that, the
            same rule the sheet tree follows. It is the workspace's own panel
            rather than the viewer's: the viewer owns the quantities it
            detected, this owns what a person decided to take off. */}
        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col p-2${
            drawers && panelOpen
              ? " [&_[data-takeoff=found-walls]]:fixed [&_[data-takeoff=found-walls]]:inset-y-0" +
                " [&_[data-takeoff=found-walls]]:right-0 [&_[data-takeoff=found-walls]]:z-40" +
                " [&_[data-takeoff=found-walls]]:w-80 [&_[data-takeoff=found-walls]]:overflow-y-auto" +
                " [&_[data-takeoff=found-walls]]:rounded-none"
              : ""
          }`}
          data-takeoff="canvas-region"
        >
          <div className="relative flex min-h-0 flex-1 flex-col">
            {summaryOpen && !phone && (
              <TakeoffSheetSummary
                items={items}
                pageNumber={page}
                hidden={hiddenItems}
                onClose={() => {
                  setSummaryOpen(false);
                  writeStored(KEY.summary, "closed");
                }}
              />
            )}
            <TakeoffPlanViewer
              jobId={jobId}
              planId={data.plan.id}
              sheets={sheets}
              printedScaleByPage={data.printedScaleByPage}
              scannedPages={data.scannedPages}
              storedWallsByPage={data.storedWallsByPage}
              takeoffItems={data.matchableItems}
              levelByPage={data.levelByPage}
              scalePrefillByPage={data.scalePrefillByPage}
              scaleDeclineByPage={data.scaleDeclineByPage}
              duplicateWallsByPage={data.duplicateWallsByPage}
              sheetLabelByPage={data.sheetLabelByPage}
              wallTypes={data.viewerWallTypes}
              initialPage={openPage}
              fill
              panelOpen={panelOpen && !phone}
              readOnly={phone}
              onMeasurementSaved={onMeasurementSaved}
              activeItemId={activeItemId}
            />
          </div>
        </main>

        {/* The items rail, after the canvas in the DOM as well as on screen:
            canvas-first is an ordering claim, not only a flex-direction. */}
        {itemsOpen && !drawers && !phone && (
          <aside
            className="w-72 shrink-0 overflow-hidden border-l border-line-card bg-surface"
            data-takeoff="items-rail"
          >
            {railContents}
          </aside>
        )}
      </div>

      {/* ── SHEET FACTS, the strip the item properties will live in ──
          Phase 1 fills it with what is true about the sheet you are on, which
          is the same question Phase 2's properties answer one level down. It
          reserves height from `--shell-port` above rather than overlaying the
          canvas, so the drawing never sits underneath it. */}
      {factsOpen && !phone && (
        <section
          className="shrink-0 overflow-y-auto border-t border-line-card bg-surface px-3 py-2"
          style={{ height: `${FACTS_REM}rem` }}
          data-takeoff="sheet-facts"
        >
          {activeItem ? (
            <TakeoffItemProperties jobId={jobId} item={activeItem} readOnly={phone} />
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
            <span className="font-semibold text-ink">
              {data.sheetLabelByPage[page] ?? `Sheet ${page}`}
            </span>
            <Fact label="Page">{page}</Fact>
            <Fact label="Scale">
              {currentSheet?.calibration
                ? "set on this sheet"
                : (data.printedScaleByPage[page] ?? "not set")}
            </Fact>
            <Fact label="Measurements">{currentSheet?.measurements.length ?? 0}</Fact>
            <Fact label="Revision">{currentRow?.proposal?.revision ?? "—"}</Fact>
            <Fact label="Issued">{currentRow?.proposal?.issueDate ?? "—"}</Fact>
              <Fact label="Bookmarked">{bookmarks.has(page) ? "yes" : "no"}</Fact>
              <span className="text-ink-muted">
                Pick an item to see and edit its properties here.
              </span>
            </div>
          )}
          {data.duplicateWallsByPage[page] && (
            <p className="mt-1 text-[11px] text-tag-amber-ink">{data.duplicateWallsByPage[page]}</p>
          )}
        </section>
      )}

      {/* ── THE WORKSPACE'S OWN HOME ──
          Over the canvas rather than a route of its own: it is a place to
          stand for a moment, not a page to link to, and leaving the viewer
          mounted means coming back costs no re-render of the drawing. */}
      {overview && !phone && (
        <div className="fixed inset-0 top-11 z-40 overflow-y-auto bg-canvas p-6" data-takeoff="overview">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ink">{jobName}</h2>
              <button
                type="button"
                onClick={() => setOverview(false)}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body"
                data-takeoff="close-overview"
              >
                Close
              </button>
            </div>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Plan set</h3>
            <p className="mt-1 text-sm text-ink-body">
              {data.plan.revisionLabel ?? data.plan.fileName ?? "Plan set"} · {sheets.length} sheet
              {sheets.length === 1 ? "" : "s"}
              {data.plan.sheetIssuedOn
                ? ` · issued ${new Date(data.plan.sheetIssuedOn).toISOString().slice(0, 10)}`
                : " · no issue date"}
            </p>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Progress</h3>
            <p className="mt-1 text-sm text-ink-body" data-takeoff="overview-progress">
              {calibratedPages.size} of {sheets.length} sheets have a scale ·{" "}
              {Object.values(measurementCountByPage).filter((count) => count > 0).length} have measurements
            </p>

            {bookmarks.size > 0 && (
              <>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Bookmarked
                </h3>
                <ul className="mt-1 flex flex-wrap gap-2" data-takeoff="overview-bookmarks">
                  {[...bookmarks]
                    .sort((a, b) => a - b)
                    .map((pageNumber) => (
                      <li key={pageNumber}>
                        <button
                          type="button"
                          onClick={() => {
                            setPage(pageNumber);
                            document.dispatchEvent(
                              new CustomEvent("takeoff-goto", { detail: { page: pageNumber } }),
                            );
                            setOverview(false);
                          }}
                          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-rail"
                        >
                          {data.sheetLabelByPage[pageNumber] ?? `Sheet ${pageNumber}`}
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}

            {/* ── AND THE SHEETS LEFT OUT, WITH THE REASON ──
                Nothing is excluded silently. A reviewer who cannot see why a
                sheet was skipped assumes the tool missed it. */}
            {excluded.length > 0 && (
              <>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Not counted ({excluded.length})
                </h3>
                <ul className="mt-1 flex flex-col gap-1" data-takeoff="excluded-sheets">
                  {excluded.map((row) => (
                    <li key={row.pageNumber} className="text-xs leading-snug text-ink-muted">
                      <span className="font-medium text-ink-body">
                        {data.sheetLabelByPage[row.pageNumber] ?? `Sheet ${row.pageNumber}`}
                      </span>{" "}
                      — {data.duplicateWallsByPage[row.pageNumber]}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          data-takeoff="toast"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line-card bg-surface px-3 py-1.5 text-xs text-ink-body shadow-lg"
        >
          {toast}
        </div>
      )}

      {/* ── DRAWERS: fixed, over a backdrop, reserving no width ──────────
          Outside the row on purpose. Inside it, even `absolute` still took its
          place in the flow on the first attempt and pushed the canvas off the
          page. `fixed` to the viewport cannot. */}
      {drawers && !phone && (sheetsOpen || panelOpen || itemsOpen) && (
        <>
          <button
            type="button"
            aria-label="Close the panels"
            onClick={closeDrawers}
            className="fixed inset-0 z-30 bg-black/50"
            data-takeoff="drawer-backdrop"
          />
          {sheetsOpen && (
            <aside
              className="fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line-card bg-surface"
              data-takeoff="sheet-drawer"
            >
              <div className="flex shrink-0 items-center justify-between px-2 pt-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Sheets</span>
                <button
                  type="button"
                  onClick={() => rememberSheets(false)}
                  className="rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-body"
                  data-takeoff="close-sheet-drawer"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1">{tree}</div>
            </aside>
          )}
          {itemsOpen && (
            <aside
              className="fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-l border-line-card bg-surface"
              data-takeoff="items-drawer"
            >
              <div className="flex shrink-0 items-center justify-between px-2 pt-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Items</span>
                <button
                  type="button"
                  onClick={() => rememberItems(false)}
                  className="rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-body"
                  data-takeoff="close-items-drawer"
                >
                  Close
                </button>
              </div>
              <div className="min-h-0 flex-1">{railContents}</div>
            </aside>
          )}
          {/* The quantities drawer IS the viewer's panel, lifted by the
              classes on <main> above. A close button lives here because that
              panel has none of its own, and a drawer you can only dismiss by
              guessing is not a drawer. Escape and the backdrop close it too. */}
          {panelOpen && (
            <button
              type="button"
              onClick={() => rememberPanel(false)}
              className="fixed right-2 top-14 z-50 rounded-md border border-line-card bg-surface px-2 py-0.5 text-xs text-ink-body"
              data-takeoff="close-panel-drawer"
            >
              Close
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-ink-muted">
      {label}: <span className="text-ink-body">{children}</span>
    </span>
  );
}
