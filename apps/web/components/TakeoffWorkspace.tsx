"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { TakeoffPlanViewer } from "@/components/TakeoffPlanViewer";
import type { TakeoffWorkspaceData } from "@/lib/takeoff/workspaceLoad";

/**
 * ── THE PLAN, AS LARGE AS THE SCREEN WILL ALLOW ──
 *
 * The takeoff tab puts the drawing inside the app chrome, beside the uploader,
 * the schedule proposals and the measurement list. That is the right page for
 * setting a job up and the wrong one for REVIEWING a takeoff, which is done at
 * arm's length with a GC on the phone — the sheet wants every pixel there is.
 *
 * So this is a shell and not a second takeoff. `TakeoffPlanViewer` still owns
 * the tool row, the scale controls, Find the walls, the detected groups and
 * every caution; it grew four props for this host — `fill`, `panelOpen`,
 * `readOnly`, `initialPage` — and nothing else changed. The identity row here
 * holds only what the viewer cannot know: which job, and the way back.
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
  { keys: "f", does: "fit" },
  { keys: "j / k", does: "next / previous sheet" },
  { keys: "Esc", does: "close a drawer" },
  { keys: "?", does: "shortcuts" },
];

/**
 * Where the quantities rail's open/closed state is remembered.
 *
 * `localStorage`, not the database: CLAUDE.md's rule is that browser storage
 * is for a per-viewer convenience — a remembered tab, a collapsed section —
 * and never for state anybody else reads back. Which rail somebody likes open
 * is exactly that, and the alternative is a column on `User` and a migration
 * for a preference.
 */
const PANEL_KEY = "prova.takeoff.panel";

/** Below this the rails are drawers rather than part of the flow. */
const RAIL_WIDTH = 1280;
/** At or above this the quantities rail starts open. */
const WIDE = 1440;
/** Below this the workspace is read-only. */
const PHONE = 768;

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  // The remembered rail, once, on mount — and defaulted by WIDTH when nothing
  // is remembered. Not in the initialiser: `localStorage` is not there during
  // the server render, and a first render that disagrees with the second is a
  // hydration mismatch, which this repo has an entire CLAUDE.md entry about.
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(PANEL_KEY);
    } catch {
      // Private windows and blocked site data both throw. A preference that
      // cannot be read is not a reason to render nothing.
    }
    if (remembered === "open") setPanelOpen(true);
    else if (remembered === "closed") setPanelOpen(false);
    else setPanelOpen(window.innerWidth >= WIDE);
    setSheetsOpen(window.innerWidth >= RAIL_WIDTH);
  }, []);

  const rememberPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    try {
      window.localStorage.setItem(PANEL_KEY, open ? "open" : "closed");
    } catch {
      // The preference still applies to this visit; it just will not survive.
    }
  }, []);

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

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // NEVER while typing: a shortcut that fires inside a scale field eats
      // somebody's dimension.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        // Escape closes a drawer and nothing else, so it cannot surprise
        // somebody mid-measurement on a desktop, where there are none.
        if (drawers && (sheetsOpen || panelOpen)) {
          setSheetsOpen(false);
          rememberPanel(false);
        }
        return;
      }
      if (event.key === "[") {
        setSheetsOpen((open) => !open);
        return;
      }
      if (event.key === "]") {
        rememberPanel(!panelOpen);
        return;
      }
      if (event.key === "?") {
        setHelpOpen((open) => !open);
        return;
      }
      // The rest belong to the viewer, which owns the canvas. Forwarded as an
      // event rather than reached into: this shell has no business holding the
      // viewer's zoom.
      if (["f", "j", "k"].includes(event.key)) {
        document.dispatchEvent(new CustomEvent("takeoff-shortcut", { detail: { key: event.key } }));
      }
    },
    [drawers, panelOpen, rememberPanel, sheetsOpen],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const sheets = data.sheets;
  const excluded = data.sheetRows.filter((row) => {
    const caution = data.duplicateWallsByPage[row.pageNumber];
    return typeof caution === "string" && caution.length > 0;
  });

  const sheetList = (
    <>
      <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Sheets ({sheets.length})
      </h2>
      <ul className="flex flex-col gap-1">
        {sheets.map((sheet) => (
          <li key={sheet.id}>
            {/* A LINK PER SHEET, not a click handler: which sheet is open is
                part of where you are, so it belongs in the URL. A reviewer can
                send "look at A-102", and Cmd-click opens a second one. */}
            <Link
              href={`/takeoff/${jobId}?page=${sheet.pageNumber}`}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface ${
                sheet.pageNumber === openPage ? "bg-surface text-ink-label" : "text-ink-body"
              }`}
              data-takeoff="sheet-link"
            >
              <span className="inline-flex h-8 w-6 shrink-0 items-center justify-center rounded border border-line-card bg-surface text-[10px] text-ink-muted">
                {sheet.pageNumber}
              </span>
              <span className="truncate">
                {data.sheetLabelByPage[sheet.pageNumber] ?? `Sheet ${sheet.pageNumber}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* ── AND THE SHEETS LEFT OUT, WITH THE REASON ──
          Nothing is excluded silently. A reviewer who cannot see why a sheet
          was skipped assumes the tool missed it. */}
      {excluded.length > 0 && (
        <div className="mt-3 border-t border-line-card pt-2" data-takeoff="excluded-sheets">
          <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Not counted ({excluded.length})
          </h2>
          <ul className="flex flex-col gap-1 px-1">
            {excluded.map((row) => (
              <li key={row.pageNumber} className="text-[11px] leading-snug text-ink-muted">
                <span className="font-medium text-ink-body">
                  {data.sheetLabelByPage[row.pageNumber] ?? `Sheet ${row.pageNumber}`}
                </span>{" "}
                — {data.duplicateWallsByPage[row.pageNumber]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  const closeDrawers = () => {
    setSheetsOpen(false);
    rememberPanel(false);
  };

  return (
    // `--shell-port` IS WHY THE DRAWING IS BIG. The viewer sizes its canvas
    // against it, and the variable is defined on the app shell's <main>; this
    // page is deliberately outside that shell, so it defines its own — the
    // viewport less the identity row. `fill` below does the rest.
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-canvas [--shell-port:calc(100dvh-2.75rem)]"
      data-takeoff="workspace"
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line-card bg-surface px-3">
        {!phone && (
          <button
            type="button"
            onClick={() => setSheetsOpen((open) => !open)}
            aria-expanded={sheetsOpen}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
            data-takeoff="toggle-sheets"
          >
            Sheets
          </button>
        )}
        <h1 className="truncate text-sm font-semibold text-ink-label" data-takeoff="workspace-job">
          {jobName}
        </h1>
        {phone && (
          <span
            className="rounded border border-line-card px-1.5 py-0.5 text-[10px] text-ink-muted"
            data-takeoff="read-only"
          >
            read-only
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!phone && (
            <>
              <button
                type="button"
                onClick={() => setHelpOpen((open) => !open)}
                className="hidden rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface sm:inline-block"
                aria-expanded={helpOpen}
              >
                Shortcuts
              </button>
              <button
                type="button"
                onClick={() => rememberPanel(!panelOpen)}
                aria-expanded={panelOpen}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
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
            Back to estimate
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
                <kbd className="rounded border border-line-card bg-surface px-1 font-mono">{entry.keys}</kbd>{" "}
                {entry.does}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── The sheet rail, IN THE FLOW only when it is a rail ────────── */}
        {sheetsOpen && !drawers && !phone && (
          <aside
            className="w-56 shrink-0 overflow-y-auto border-r border-line-card bg-surface p-2"
            data-takeoff="sheet-rail"
          >
            {sheetList}
          </aside>
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
          <TakeoffPlanViewer
            jobId={jobId}
            planId={data.plan.id}
            sheets={sheets}
            printedScaleByPage={data.printedScaleByPage}
            scannedPages={data.scannedPages}
            storedWallsByPage={data.storedWallsByPage}
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
          />
        </main>
      </div>

      {/* ── DRAWERS: fixed, over a backdrop, reserving no width ──────────
          Outside the row on purpose. Inside it, even `absolute` still took its
          place in the flow on the first attempt and pushed the canvas off the
          page. `fixed` to the viewport cannot. */}
      {drawers && !phone && (sheetsOpen || panelOpen) && (
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
              className="fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-line-card bg-surface p-2"
              data-takeoff="sheet-drawer"
            >
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Sheets</span>
                <button
                  type="button"
                  onClick={() => setSheetsOpen(false)}
                  className="rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-body"
                  data-takeoff="close-sheet-drawer"
                >
                  Close
                </button>
              </div>
              {sheetList}
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
