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
 * arm's length on a laptop with a GC on the phone — the sheet wants every
 * pixel there is.
 *
 * So this is a shell and not a second takeoff. `TakeoffPlanViewer` is rendered
 * unchanged: it already owns the tool row, the scale controls, Find the walls,
 * the detected groups and every caution, and it already sizes itself against
 * `--shell-port`. What it has never had is a sheet list beside it, a viewport
 * to fill, or anywhere to put a keyboard shortcut.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not re-implement the toolbar in its own top bar. The spec asks for
 * the scale control and Find the walls up there, and they ARE up there — on
 * the viewer's own row, directly under the identity row. Copying them into
 * this file would make two controls that mean the same thing, which is the
 * shape this repo keeps paying for. The identity row holds what the viewer has
 * no way of knowing: which job this is, and the way back to the estimate.
 */

type Props = {
  jobId: string;
  jobName: string;
  data: TakeoffWorkspaceData & object;
  /** When the plan was last written, so a second tab can notice a newer save. */
  savedAt: string;
  /** The sheet to open on, out of the URL. */
  openPage: number;
};

/** The shortcuts, in one place so the help row and the handler cannot disagree. */
const KEYS: { keys: string; does: string }[] = [
  { keys: "[", does: "sheets panel" },
  { keys: "]", does: "quantities panel" },
  { keys: "f", does: "zoom to fit" },
  { keys: "o", does: "overlay on/off" },
  { keys: "j / k", does: "next / previous sheet" },
  { keys: "?", does: "shortcuts" },
];

export function TakeoffWorkspace({ jobId, jobName, data, savedAt, openPage }: Props) {
  const [sheetsOpen, setSheetsOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  // ── A SECOND TAB'S SAVE WINS, AND THIS ONE HAS TO SAY SO ──
  //
  // Two tabs on one takeoff is not a corner case: it is how somebody compares
  // two levels. The later save already wins, because every write is a server
  // action against the same rows — what was missing is that the other tab goes
  // on showing numbers that are no longer current, with nothing to say so.
  //
  // Asked on focus rather than polled. A poll would be a request every few
  // seconds for every open workspace, forever, to answer a question that only
  // matters when somebody comes back to the tab.
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

  const onKey = useCallback((event: KeyboardEvent) => {
    // NEVER while typing. A shortcut that fires inside a scale field is a
    // shortcut that eats somebody's dimension.
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "[") {
      setSheetsOpen((open) => !open);
      return;
    }
    if (event.key === "]") {
      setPanelOpen((open) => !open);
      return;
    }
    if (event.key === "?") {
      setHelpOpen((open) => !open);
      return;
    }
    // The rest belong to the viewer, which owns the canvas and the overlay.
    // Forwarded as events on the document it already listens to rather than
    // reached into: this shell has no business holding the viewer's state.
    if (["f", "o", "j", "k"].includes(event.key)) {
      document.dispatchEvent(new CustomEvent("takeoff-shortcut", { detail: { key: event.key } }));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const sheets = data.sheets;
  const excluded = data.sheetRows.filter((row) => {
    const caution = data.duplicateWallsByPage[row.pageNumber];
    return typeof caution === "string" && caution.length > 0;
  });

  // ── `--shell-port` IS WHY THE DRAWING IS BIG ──
  //
  // `TakeoffPlanViewer` already sizes its canvas against it:
  // `max-h-[calc(var(--shell-port)-11rem)]`. The variable is defined on the app
  // shell's <main>, and this page is deliberately outside that shell — so
  // without this line the calc has no value, the max-height is dropped, and the
  // port falls back to its `min-h-[24rem]` floor.
  //
  // MEASURED: the first screenshot of this workspace showed a 1440px window
  // with the plan at 18% in a 384px box and half the viewport empty under it,
  // which is the opposite of the one thing this route exists to do.
  //
  // So the shell's own contract is honoured rather than the viewer changed: the
  // port here is the viewport less the identity row above it.
  return (
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-canvas [--shell-port:calc(100dvh-2.75rem)]"
      data-takeoff="workspace"
    >
      {/* ── The identity row. Slim, and it holds only what the viewer cannot
           know: which job, and the way back. ───────────────────────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line-card bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setSheetsOpen((open) => !open)}
          aria-expanded={sheetsOpen}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
          data-takeoff="toggle-sheets"
        >
          Sheets
        </button>
        <h1 className="truncate text-sm font-semibold text-ink-label" data-takeoff="workspace-job">
          {jobName}
        </h1>
        <span className="hidden text-xs text-ink-muted sm:inline">Takeoff workspace</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen((open) => !open)}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
            aria-expanded={helpOpen}
          >
            Shortcuts
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-body hover:bg-surface"
            data-takeoff="toggle-panel"
          >
            Quantities
          </button>
          {/* A REAL LINK, so Cmd-click and right-click do what they always do.
              Not a router.push on a button: that is a page a person cannot
              open in a second tab, which is exactly what somebody comparing an
              estimate against a drawing wants to do. */}
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

      {helpOpen && (
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
        {/* ── Left: the sheets, floor plans first ─────────────────────────
             A drawer under `lg`, where a 14rem rail would leave the drawing
             narrower than the panel beside it. */}
        {sheetsOpen && (
          <aside
            className="absolute inset-y-0 left-0 z-20 w-64 shrink-0 overflow-y-auto border-r border-line-card bg-surface p-2 lg:static lg:z-auto lg:w-56"
            data-takeoff="sheet-rail"
          >
            <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Sheets ({sheets.length})
            </h2>
            <ul className="flex flex-col gap-1">
              {sheets.map((sheet) => (
                <li key={sheet.id}>
                  {/* A LINK PER SHEET, not a click handler. The sheet open is
                      part of where you are, so it belongs in the URL: a
                      reviewer can send "look at A-102" to somebody else. */}
                  <Link
                    href={`/takeoff/${jobId}?page=${sheet.pageNumber}`}
                    scroll={false}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-body hover:bg-surface"
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

            {/* ── AND THE SHEETS THAT WERE LEFT OUT, WITH THE REASON ──
                 Diego's rule, from the multi-view work: nothing is excluded
                 silently. A reviewer who cannot see why a sheet was skipped
                 assumes the tool missed it. */}
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
          </aside>
        )}

        {/* ── Centre: the drawing, and everything the viewer already owns ── */}
        <main
          className="min-w-0 flex-1 overflow-auto p-2"
          data-takeoff="canvas-region"
          data-panel-open={panelOpen ? "yes" : "no"}
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
          />
        </main>
      </div>
    </div>
  );
}
