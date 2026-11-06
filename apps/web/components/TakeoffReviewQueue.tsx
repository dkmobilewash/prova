"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UndoEntry } from "@/lib/takeoff/undoStack";
import { confirmSheetScales, confirmSheetSuggestions, confirmWindows, priceLineFromCost, reviewWall, setWallGroupHeight, undoSheetSuggestions, type SheetSuggestionsUndo } from "@/lib/actions";
import { COST_CATEGORY_LONG_LABEL, COST_CATEGORY_VALUES } from "@/lib/cost-category";
import { QueueGroupConfirm } from "./QueueGroupConfirm";
import { QueueWindowsConfirm } from "./QueueWindowsConfirm";
import { forCode, QUEUE_PART, heightFor, legendMissing, levelHeightFor, sheetSuggestionGroups, type CodeHeight, type LegendState, type ReviewItem } from "@/lib/takeoff/reviewQueue";
import type { PlanSetRow } from "@/lib/takeoff/planSet";
import { inchLabel } from "@/lib/takeoff/wallVectors";

/**
 * ── THE JOB'S ONE REVIEW QUEUE, ONE ITEM AT A TIME ──
 *
 * What the stepper's Review opens (`?open=review`). The item on screen is
 * zoomed to on its sheet by the workspace (`onShow`); its buttons are the
 * pieces that already decide it — `reviewWall` for a held run, the plan set's
 * fixes for a sheet's scale, and for a price either the line's cost (once the
 * company's markup is set — the price is worked from it, `priceLineFromCost`)
 * or the estimate line itself.
 *
 * A WALL GROUP IS CONFIRMED, NOT FILLED IN (`QueueGroupConfirm`): its walls lit
 * on the plan, the suggested type and height already in place with where each
 * came from, and Enter accepts both (`confirmSheetSuggestions` for one group, so Undo can put it back; `setWallGroupHeight`
 * for a group whose type is settled). The queue moves on at once and the save
 * follows; one that fails comes back with its reason. Next (or N) skips
 * without deciding; an item leaves when the row behind it changes, and the
 * queue is done when empty.
 */
export function TakeoffReviewQueue({
  jobId,
  planId,
  items,
  legendCodes,
  heights = {},
  legend = "read",
  heightChoices = {},
  planSet,
  onShow,
  onLeft,
  doubted = 0,
  onCheckDoubted,
  onClose,
  onUndoable,
}: {
  jobId: string;
  planId: string;
  items: ReviewItem[];
  legendCodes: string[];
  /** Each type's height by code (`loadReviewQueue`), for the pre-filled height. */
  heights?: Readonly<Record<string, CodeHeight>>;
  /** Whether the set's legend was read: with none, a group's height says why it has none from the drawings. */
  legend?: LegendState;
  /** Each type's heights by part of the building (Joplin's three roofs), offered as choices. */
  heightChoices?: Readonly<Record<string, readonly CodeHeight[]>>;
  planSet: PlanSetRow[];
  onShow: (item: ReviewItem | null) => void;
  /** Told how many are left whenever that changes, so the top bar's count is this one. */
  onLeft?: (n: number) => void;
  /** Posted walls the model doubts that are not in this queue: Keep/Drop, as a step of it. */
  doubted?: number;
  onCheckDoubted?: () => void;
  onClose: () => void;
  /** The workspace's undo stack: a group typed or a height set here can be taken back (Undo, ⌘Z). */
  onUndoable?: (entry: UndoEntry) => void;
}) {
  // Decided here, before the server's re-render drops it from `items`.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<string | null>(null);
  const left = items.filter((item) => !done.has(item.key));
  const current = left.find((item) => item.key === cursor) ?? left[0] ?? null;
  // ── ACCEPT ALL SUGGESTIONS ON THIS SHEET ──
  // Every group on the sheet on show whose type the drawing gave (a printed
  // tag or the legend), each with the height Enter would take. Library
  // guesses by thickness stay for a person to look at. One line says what
  // went in, with Undo.
  const [accepted, setAccepted] = useState<{ text: string; keys: string[]; undo: SheetSuggestionsUndo } | null>(null);
  const sheetGroups = current === null || current.kind !== "type" ? [] : sheetSuggestionGroups(left, current.pageNumber, heights, planId);
  type TypeItem = Extract<ReviewItem, { kind: "type" }>;
  const heightOfGroup = (g: TypeItem, code: string | null) => levelHeightFor(code, g.level) ?? forCode(g.building?.heights ?? {}, code) ?? heightFor(code, heights, g.ceiling);
  // The groups on this sheet nothing on the drawing names: no tag, no legend, no library guess.
  const unnamed = current === null || current.kind !== "type" || current.suggested !== null ? [] : left.filter((item): item is TypeItem => item.kind === "type" && item.pageNumber === current.pageNumber && item.suggested === null);
  // ── THE SHEET'S GROUPS, COUNTED THE WAY THE TWO BUTTONS COUNT THEM ──
  // The queue shows one group at a time, so "Accept all … (9 groups)" and "on all
  // 11 groups nothing names" were checked by stepping through, and came out 10 and
  // 10 (Chrome on Baker A101). Said once, beside the buttons, so each count can be
  // read against what it covers: named by the drawing (Accept all), suggested by
  // thickness alone (one by one: the thickness is a guess), named by nothing (A).
  const sheetTypes = current === null || current.kind !== "type" ? [] : left.filter((item): item is TypeItem => item.kind === "type" && item.pageNumber === current.pageNumber);
  const sheetCounts = {
    drawn: sheetTypes.filter((g) => g.suggested?.drawn === true).length,
    guessed: sheetTypes.filter((g) => g.suggested !== null && g.suggested.drawn !== true).length,
    none: sheetTypes.filter((g) => g.suggested === null).length,
  };
  async function acceptSheet(groups: readonly { key: string; feet: number | null; group: Parameters<typeof confirmSheetSuggestions>[1][number] }[] = sheetGroups) {
    if (current === null || current.kind !== "type" || groups.length === 0) return;
    const sheet = current.sheet;
    setBusy(true);
    setError(null);
    setAccepted(null);
    setDone((was) => new Set([...was, ...groups.map((g) => g.key)]));
    const result = await confirmSheetSuggestions(
      jobId,
      groups.map((g) => g.group),
    ).catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
    setBusy(false);
    if (!result.ok) {
      setDone((was) => new Set([...was].filter((key) => !groups.some((g) => g.key === key))));
      return setError(`Accept all on sheet ${sheet}: ${result.error}`);
    }
    const feet = groups.reduce((n, g) => n + (g.feet ?? 0), 0);
    const { accepted: n, failed, undo } = result.value;
    setAccepted({
      text: `Accepted ${n} group${n === 1 ? "" : "s"} on sheet ${sheet} · ${Math.round(feet).toLocaleString()} ft${failed.length > 0 ? ` · not accepted: ${failed.join("; ")}` : ""}`,
      keys: groups.map((g) => g.key),
      undo,
    });
    router.refresh();
  }
  async function undoAccept() {
    if (accepted === null) return;
    const was = accepted;
    setBusy(true);
    const result = await undoSheetSuggestions(jobId, was.undo).catch(() => ({ ok: false as const, error: "it did not undo. Try it again." }));
    setBusy(false);
    if (!result.ok) return setError(`Undo: ${result.error}`);
    setAccepted(null);
    setDone((done) => new Set([...done].filter((key) => !was.keys.includes(key))));
    router.refresh();
  }
  // ── "Groups 3 of 8 · Held walls 0 of 34" ──
  // Every item this queue has shown, by part: the server drops a decided one
  // from `items`, so the total is what was ever seen and done is what is not
  // left of it. A height item that joins later counts in its part.
  const seen = useRef(new Map<string, Set<string>>());
  for (const item of items) {
    const part = QUEUE_PART[item.kind];
    seen.current.set(part, (seen.current.get(part) ?? new Set()).add(item.key));
  }
  const progress = [...seen.current].map(([part, keys]) => {
    const open = left.filter((item) => keys.has(item.key)).length;
    return `${part} ${keys.size - open} of ${keys.size}`;
  });
  const after = (key: string) => {
    const at = left.findIndex((item) => item.key === key);
    return left.length < 2 ? null : left[(at + 1) % left.length]!.key;
  };

  // A price is set on the estimate, in its own tab: coming back reads the queue again.
  // ONE tab for the job's estimate, named, so every price lands in it on its
  // line instead of opening a tab each (new-customer run v2, M5: nine prices,
  // nine tabs). No `rel`: noopener can stop a browser reusing a named tab.
  const router = useRouter();
  const pricing = useRef(false);
  useEffect(() => {
    const onFocus = () => {
      if (!pricing.current) return;
      pricing.current = false;
      router.refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  useEffect(() => onShow(current), [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- the item's key is its identity
  useEffect(() => onLeft?.(left.length), [left.length]); // eslint-disable-line react-hooks/exhaustive-deps -- the count is what changes

  // ── K, D AND N ON A WALL TO CONFIRM ──
  // Taken before the workspace's keys (its K pages back a sheet) and only
  // while a held wall is on show; never while somebody types in a field.
  const wallKeys = useRef<(event: KeyboardEvent) => void>(() => {});
  wallKeys.current = (event) => {
    if (current === null || current.kind !== "wall" || busy || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (key === "k") void decide(() => reviewWall(jobId, current.measurementId, "keep"));
    else if (key === "d") void decide(() => reviewWall(jobId, current.measurementId, "drop"));
    else if (key === "n") setCursor(after(current.key));
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => wallKeys.current(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  async function decide(run: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (current === null) return;
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCursor(after(current.key));
    setDone((was) => new Set(was).add(current.key));
  }

  /** Accept now, save behind: the next item is on screen before the server answers. */
  function acceptNow<R extends { ok: true } | { ok: false; error: string }>(key: string, what: string, run: () => Promise<R>, undoOf?: (saved: Extract<R, { ok: true }>) => UndoEntry) {
    setError(null);
    setCursor(after(key));
    setDone((was) => new Set(was).add(key));
    const back = (why: string) => {
      setDone((was) => {
        const next = new Set(was);
        next.delete(key);
        return next;
      });
      setError(`${what}: ${why}`);
    };
    void run().then(
      (result) => {
        if (!result.ok) return back(result.error);
        if (undoOf === undefined || onUndoable === undefined) return;
        // ── UNDO PUTS IT BACK, AND THE ITEM BACK IN THE QUEUE ──
        const entry = undoOf(result as Extract<R, { ok: true }>);
        onUndoable({
          ...entry,
          undo: async () => {
            const undone = await entry.undo();
            if (undone.ok) {
              setDone((was) => {
                const next = new Set(was);
                next.delete(key);
                return next;
              });
              // Back on the item just undone, so it is what the person sees.
              setCursor(key);
            }
            return undone;
          },
          redo: async () => {
            const again = await entry.redo();
            if (again.ok) setDone((was) => new Set(was).add(key));
            return again;
          },
          inPlace: true,
        });
      },
      () => back("it did not save. Try it again."),
    );
  }

  const button = "min-h-[32px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  const primaryButton = "min-h-[32px] rounded-md border border-brand bg-brand px-3 text-xs font-semibold text-neutral-900 disabled:opacity-50";
  const row = current !== null && current.kind === "scale" ? planSet.find((r) => r.pageNumber === current.pageNumber) : undefined;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-card bg-surface px-3 py-1.5 text-xs text-ink-body" data-takeoff="review-queue">
      <span className="font-semibold" data-takeoff="review-queue-left">
        {left.length === 0 ? "Nothing left to review" : `${left.length} left to review`}
      </span>
      {progress.length > 0 && (
        <span className="text-ink-muted" data-takeoff="review-queue-progress">
          {progress.join(" · ")}
        </span>
      )}
      {current === null ? (
        <a href={`/jobs/${jobId}`} className="underline" data-takeoff="review-queue-done">
          Back to the job
        </a>
      ) : (
        <span className="contents" data-takeoff="review-queue-item" data-kind={current.kind}>
          {current.kind === "wall" && (
            <>
              <span>
                Wall to confirm · sheet {current.sheet}
                {current.feet !== null && ` · ${Math.round(current.feet)} ft`}
              </span>
              <button type="button" className={button} disabled={busy} onClick={() => void decide(() => reviewWall(jobId, current.measurementId, "keep"))} data-takeoff="review-queue-keep">
                It&rsquo;s a wall
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => void decide(() => reviewWall(jobId, current.measurementId, "drop"))} data-takeoff="review-queue-drop">
                Not a wall
              </button>
              <span className="hidden text-ink-muted mouse:inline" data-takeoff="review-queue-wall-keys">
                K it&rsquo;s a wall · D not a wall · N skip
              </span>
            </>
          )}
          {current.kind === "type" &&
            (legendCodes.length === 0 && current.suggested === null ? (
              <>
                <span>
                  Untyped walls · sheet {current.sheet} · {inchLabel(current.inches)}
                </span>
                <span className="text-ink-muted">No wall types to pick from: add them on the Wall types page.</span>
              </>
            ) : (
              <QueueGroupConfirm
                key={current.key}
                label={`Walls · sheet ${current.sheet}${current.level ? ` · ${current.level.label}` : ""}${current.building ? ` · ${current.building.name.toLowerCase()}` : ""} · ${inchLabel(current.inches)}${current.feet !== null ? ` · ${Math.round(current.feet)} ft` : ""}`}
                codes={current.suggested === null || legendCodes.some((c) => c.toUpperCase() === current.suggested!.code.toUpperCase()) ? legendCodes : [...legendCodes, current.suggested.code]}
                suggested={current.suggested}
                missing={legendMissing(legend, jobId)}
                heightOf={(code) => heightOfGroup(current, code)}
                heightOptions={(code) => forCode(heightChoices, code) ?? []}
                onSkip={() => setCursor(after(current.key))}
                rest={unnamed.length > 1 ? `${unnamed.length} groups nothing names on ${current.sheet}` : null}
                onAcceptRest={(code, heightFt) => {
                  // The type picked here on every group of the sheet nothing names
                  // (walk v6: 13 of them, two keys each). Each keeps its own height
                  // unless a height was typed here; one line says it, with Undo.
                  const offered = heightOfGroup(current, code)?.feet ?? null;
                  void acceptSheet(
                    unnamed.map((g) => ({
                      key: g.key,
                      feet: g.feet,
                      group: { planId, pageNumber: g.pageNumber, code, inches: g.inches, runs: g.runs, heightFt: heightFt === offered ? (heightOfGroup(g, code)?.feet ?? null) : heightFt, level: levelHeightFor(code, g.level) === null ? null : g.level!.label },
                    })),
                  );
                }}
                onAccept={(code, heightFt) => {
                  // One group through the sheet's confirm, for the token Undo puts it back with.
                  const group = { planId, pageNumber: current.pageNumber, code: code!, inches: current.inches, runs: current.runs, heightFt, level: levelHeightFor(code, current.level) === null ? null : current.level!.label };
                  acceptNow(
                    current.key,
                    `${code} on sheet ${current.sheet}`,
                    async () => {
                      const result = await confirmSheetSuggestions(jobId, [group]);
                      if (!result.ok) return result;
                      return result.value.accepted === 1 ? result : { ok: false as const, error: result.value.failed[0] ?? "it did not save. Try it again." };
                    },
                    (saved) => ({
                      label: `Type ${code} on ${current.sheet}`,
                      undo: () => undoSheetSuggestions(jobId, saved.value.undo),
                      redo: async () => {
                        const again = await confirmSheetSuggestions(jobId, [group]);
                        return again.ok ? { ok: true as const } : again;
                      },
                    }),
                  );
                }}
              />
            ))}
          {current.kind === "height" && (
            <QueueGroupConfirm
              key={current.key}
              label={`No height · ${current.name} · sheet ${current.sheet}${current.feet !== null ? ` · ${Math.round(current.feet)} ft` : ""}`}
              codes={[]}
              suggested={null}
              missing={legendMissing(legend, jobId)}
              heightOptions={() => (current.options.length > 1 ? current.options.map((o) => ({ feet: o.feet, from: o.from })) : [])}
              heightOf={() => {
                // The type's own height first, as for a group being typed; else the ceiling.
                const first = current.options[0]; // in suggestion order: type, general note, ceiling (`heightOptionsInOrder`)
                return first === undefined ? null : { feet: first.feet, from: first.from };
              }}
              onSkip={() => setCursor(after(current.key))}
              onAccept={(_code, heightFt) => {
                if (heightFt === null) return setError("Type a height first: H.");
                const itemId = current.itemId;
                acceptNow(current.key, current.name, () => setWallGroupHeight(jobId, itemId, heightFt), (saved) => ({
                  label: `Height ${heightFt} ft on ${current.name}`,
                  undo: () => undoSheetSuggestions(jobId, { moved: [], created: [], items: [{ id: itemId, heightFt: saved.value.was.heightFt, sides: saved.value.was.sides }] }),
                  redo: () => setWallGroupHeight(jobId, itemId, heightFt),
                }));
              }}
            />
          )}
          {current.kind === "windows" && (
            <QueueWindowsConfirm
              key={current.key}
              item={current}
              onShow={onShow}
              onSkip={() => setCursor(after(current.key))}
              onAccept={(kept) => acceptNow(current.key, `windows on sheet ${current.sheet}`, () => confirmWindows(jobId, planId, current.pageNumber, kept))}
            />
          )}
          {current.kind === "scale" && (
            <>
              <span>No scale · floor plan {current.sheet}</span>
              {row?.confidence === "high" && row.scaleName !== null && (
                <button type="button" className={button} disabled={busy} onClick={() => void decide(() => confirmSheetScales(jobId, planId, [current.pageNumber]))} data-takeoff="review-queue-confirm-scale">
                  Confirm {row.scaleName}
                </button>
              )}
              {row?.printedFix === true && row.scaleName !== null && (
                <button type="button" className={button} disabled={busy} onClick={() => void decide(() => confirmSheetScales(jobId, planId, [current.pageNumber], true))} data-takeoff="review-queue-printed">
                  Use the printed scale {row.scaleName}
                </button>
              )}
              <button
                type="button"
                className={button}
                onClick={() => document.dispatchEvent(new CustomEvent("takeoff-shortcut", { detail: { key: "s" } }))}
                data-takeoff="review-queue-set-scale"
              >
                Set it by two clicks
              </button>
            </>
          )}
          {current.kind === "price" && current.askCost && (
            <form
              key={current.key}
              className="contents"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const line = current;
                void decide(async () => {
                  const result = await priceLineFromCost(jobId, line.lineItemId, form);
                  if (!result.ok) return result;
                  setPriced(`${line.description}: $${result.value.unitPrice} per ${line.unit ?? "unit"}, with your markup`);
                  router.refresh();
                  return { ok: true };
                });
              }}
              data-takeoff="review-queue-cost"
            >
              <span>
                No price · {current.description} · {current.quantity} {current.unit ?? ""}
              </span>
              <label className="inline-flex items-center gap-1">
                Your cost per {current.unit ?? "unit"} $
                <input name="unitCost" inputMode="decimal" autoComplete="off" required className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-xs text-ink" data-takeoff="review-queue-cost-input" />
              </label>
              {current.costCategory === null && (
                <select name="costCategory" required defaultValue="" className="rounded-md border border-line-card bg-canvas px-2 py-1 text-xs text-ink" aria-label="What kind of cost" data-takeoff="review-queue-cost-category">
                  <option value="" disabled>
                    Material or labor?
                  </option>
                  {COST_CATEGORY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {COST_CATEGORY_LONG_LABEL[value]}
                    </option>
                  ))}
                </select>
              )}
              <button type="submit" className={primaryButton} disabled={busy} data-takeoff="review-queue-cost-save">
                Price it
              </button>
            </form>
          )}
          {current.kind === "price" && !current.askCost && (
            <>
              <span>
                No price · {current.description} · {current.quantity} {current.unit ?? ""}
              </span>
              <a href={`/jobs/${jobId}/estimate?line=${current.lineItemId}#line-${current.lineItemId}`} target={`estimate-${jobId}`} onClick={() => (pricing.current = true)} className={button + " inline-flex items-center"} data-takeoff="review-queue-line">
                Open the line ↗
              </a>
            </>
          )}
          {sheetTypes.length > 1 && current.kind === "type" && (
            <span className="text-ink-muted" data-takeoff="review-queue-sheet-counts">
              {current.sheet}: {sheetTypes.length} groups ·{" "}
              {[
                `${sheetCounts.drawn} named by the drawing`,
                ...(sheetCounts.guessed > 0 ? [`${sheetCounts.guessed} suggested by thickness alone, one by one`] : []),
                `${sheetCounts.none} named by nothing`,
              ].join(" · ")}
            </span>
          )}
          {sheetGroups.length > 1 && (
            <button type="button" className={button} disabled={busy} onClick={() => void acceptSheet()} data-takeoff="review-queue-accept-sheet" title="Every group whose type a printed tag or the legend gives, with its height; the rest stay here">
              Accept all suggestions on this sheet ({sheetGroups.length} groups)
            </button>
          )}
          {left.length > 1 && (
            <button type="button" className={button} disabled={busy} onClick={() => setCursor(after(current.key))} data-takeoff="review-queue-next">
              Next
            </button>
          )}
        </span>
      )}
      {doubted > 0 && onCheckDoubted && (
        <button type="button" className={button} onClick={onCheckDoubted} data-takeoff="review-queue-doubted" title="Keep or drop each posted wall, most doubted first, from the keyboard (K, D, U)">
          Check the walls the model doubts · {doubted}
        </button>
      )}
      <button type="button" className="underline" onClick={onClose} data-takeoff="review-queue-close">
        Close
      </button>
      {accepted !== null && (
        <span className="flex items-center gap-2" data-takeoff="review-queue-accepted">
          <span data-takeoff="review-queue-accepted-text">{accepted.text}</span>
          <button type="button" className="underline" disabled={busy} onClick={() => void undoAccept()} data-takeoff="review-queue-accepted-undo">
            Undo
          </button>
        </span>
      )}
      {priced !== null && error === null && (
        <span className="text-ink-muted" data-takeoff="review-queue-priced">
          {priced}
        </span>
      )}
      {error !== null && <span className="text-tag-amber-ink">{error}</span>}
    </div>
  );
}
