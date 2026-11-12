"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/shared";
import type { UndoEntry } from "@/lib/takeoff/undoStack";
import { confirmSheetScales, confirmSheetSuggestions, recordQueueSkip, confirmWindows, undoAutoPost, undoConfirmWindows, priceLineFromCost, reviewWall, setWallGroupHeight, undoSheetSuggestions, type SheetSuggestionsUndo } from "@/lib/actions";
import { shortScaleName } from "@/lib/takeoff/scaleFromDimensions";
import { COST_CATEGORY_LONG_LABEL, COST_CATEGORY_VALUES } from "@/lib/cost-category";
import { QueueGroupConfirm } from "./QueueGroupConfirm";
import { QueueWindowsConfirm } from "./QueueWindowsConfirm";
import { LegendThumb } from "./LegendCrop";
import type { StoredCrop } from "@/lib/takeoff/legendProposal";
import { byThickness, forCode, QUEUE_PART, sameOnOtherFloors, sameWindowsOnOtherFloors, heightFor, legendMissing, levelHeightFor, sheetSuggestionGroups, type CodeHeight, type LegendState, type ReviewItem } from "@/lib/takeoff/reviewQueue";
import type { PlanSetRow } from "@/lib/takeoff/planSet";
import { inchLabel } from "@/lib/takeoff/wallVectors";
import { specSaysLine, type SpecSay } from "@/lib/specs/specTradeFacts";
import { queueHeader } from "@/lib/takeoff/autoPost";

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
/** One empty map for "no heights", so an effect keyed on `heights` does not run on every render. */
const NO_HEIGHTS: Readonly<Record<string, CodeHeight>> = {};

export function TakeoffReviewQueue({
  jobId,
  planId,
  items,
  legendCodes,
  heights = NO_HEIGHTS,
  legend = "read",
  heightChoices = {},
  specSays = {},
  planSet,
  onShow,
  onLeft,
  doubted = 0,
  onCheckDoubted,
  onClose,
  onUndoable,
  autoPosted = [],
  codeInfo = {},
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
  /** What the spec says that changes the price, per type code; "*" for a group no type is suggested for. */
  specSays?: Readonly<Record<string, readonly SpecSay[]>>;
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
  /** What proven sources posted without the queue, per sheet (`autoPost.ts`): the header's footage, each with Undo. */
  autoPosted?: readonly { pageNumber: number; sheet: string; feet: number; doors?: number }[];
  /** Each code's thickness and legend picture (`loadReviewQueue`), for an untagged group's picker. */
  codeInfo?: Readonly<Record<string, { thicknessIn: number | null; crop: StoredCrop | null; legendPage: number | null }>>;
}) {
  // Decided here, before the server's re-render drops it from `items`.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<string | null>(null);
  const [undone, setUndone] = useState<ReadonlySet<number>>(new Set());
  // ── CONFIRM ONCE PER SET: after a group is confirmed, the same drawn group on the other floors, one click ──
  const [windowsOffer, setWindowsOffer] = useState<Extract<ReviewItem, { kind: "windows" }>[] | null>(null);
  // The other floors' windows confirmed in one click: what the line says, and how its Undo takes them all back.
  const [windowsApplied, setWindowsApplied] = useState<{ text: string; undo: () => Promise<ActionResult> } | null>(null);
  const [floorsOffer, setFloorsOffer] = useState<{ what: string; groups: ReturnType<typeof sameOnOtherFloors> } | null>(null);
  const left = items.filter((item) => !done.has(item.key));
  const current = left.find((item) => item.key === cursor) ?? left[0] ?? null;
  // ── ACCEPT ALL SUGGESTIONS ON THIS SHEET ──
  // Every group on the sheet on show whose type the drawing gave (a printed
  // tag or the legend), each with the height Enter would take. Library
  // guesses by thickness stay for a person to look at. One line says what
  // went in, with Undo.
  // `record` is shared with the toolbar's Undo stack: whichever undoes it first, the other has nothing left to undo.
  const [accepted, setAccepted] = useState<{ text: string; keys: string[]; record: { undo: SheetSuggestionsUndo; live: boolean }; known: Set<string> } | null>(null);
  // ── A HEIGHT A PERSON JUST TYPED FOR A TYPE IS THE NEXT GROUPS' TOO ──
  // The accept is optimistic, so the next groups render before the server's `heights` know it:
  // the Totem Lake walk was asked 10 ft three times for W1. Kept only until the server's heights
  // next arrive, which then speak for the job (an Undo included).
  const [typedHeights, setTypedHeights] = useState<Record<string, CodeHeight>>({});
  useEffect(() => setTypedHeights({}), [heights]);
  const heightsNow = useMemo(() => ({ ...heights, ...typedHeights }), [heights, typedHeights]);
  const rememberHeight = (code: string | null, heightFt: number | null, typed: boolean) => {
    if (code && heightFt !== null && typed) setTypedHeights((was) => ({ ...was, [code]: { feet: heightFt, from: `typed for ${code} on this sheet` } }));
  };
  const sheetGroups = current === null || current.kind !== "type" ? [] : sheetSuggestionGroups(left, current.pageNumber, heightsNow, planId);
  type TypeItem = Extract<ReviewItem, { kind: "type" }>;
  const heightOfGroup = (g: TypeItem, code: string | null) => levelHeightFor(code, g.level) ?? forCode(g.building?.heights ?? {}, code) ?? heightFor(code, heightsNow, g.ceiling);
  // The groups on this sheet nothing on the drawing names: no tag, no legend, no library guess.
  const unnamed = current === null || current.kind !== "type" || current.suggested !== null ? [] : left.filter((item): item is TypeItem => item.kind === "type" && item.pageNumber === current.pageNumber && item.suggested === null);
  // ── THE SHEET'S GROUPS, COUNTED THE WAY THE TWO BUTTONS COUNT THEM ──
  // The queue shows one group at a time, so "Accept all … (9 groups)" and "on all
  // 11 groups nothing names" were checked by stepping through, and came out 10 and
  // 10 (Chrome on Baker A101). Said once, beside the buttons, so each count can be
  // read against what it covers: named by the drawing (Accept all), suggested by
  // thickness alone (one by one: the thickness is a guess), named by nothing (A).
  // ── ONE TYPE ON GROUPS OF DIFFERENT THICKNESS, SAID ON THE BUTTON ──
  // "All" types every group nothing names, whatever its thickness — built that way for
  // walk v6, and kept. With a trade's preset types nothing matched by thickness on Green
  // Bay or E Street (walk, 2026-11-08), so one keypress put a 3-7/8" and a 13-1/2" wall on
  // one type. The button now shows the spread, so it is a choice made seeing it.
  const restInches = unnamed.map((g) => g.inches).filter((n) => n > 0);
  const restSpread =
    restInches.length > 1 && Math.max(...restInches) - Math.min(...restInches) >= 1 / 16
      ? `, ${inchLabel(Math.min(...restInches))} to ${inchLabel(Math.max(...restInches))}`
      : "";
  const sheetTypes = current === null || current.kind !== "type" ? [] : left.filter((item): item is TypeItem => item.kind === "type" && item.pageNumber === current.pageNumber);
  const sheetCounts = {
    drawn: sheetTypes.filter((g) => g.suggested?.drawn === true).length,
    guessed: sheetTypes.filter((g) => g.suggested !== null && g.suggested.drawn !== true).length,
    none: sheetTypes.filter((g) => g.suggested === null).length,
  };
  async function acceptSheet(
    groups: readonly { key: string; feet: number | null; group: Parameters<typeof confirmSheetSuggestions>[1][number] }[] = sheetGroups,
    /** What the line and the Undo stack call it; the sheet's Accept all when not given. */
    across?: { done: string; undo: string },
  ) {
    if (groups.length === 0) return;
    if (across === undefined && (current === null || current.kind !== "type")) return;
    const sheet = current !== null && "sheet" in current ? current.sheet : "";
    setBusy(true);
    setError(null);
    setAccepted(null);
    const known = seenKeys();
    forgetAfter.current = null;
    setDone((was) => new Set([...was, ...groups.map((g) => g.key)]));
    // For `TakeoffEvent`: one Accept all press, each group with the source its suggestion came from.
    const sourceOf = (key: string) => {
      const item = items.find((i) => i.key === key);
      return item?.kind === "type" ? (item.suggested?.source ?? "none") : "none";
    };
    const withSource = () => groups.map((g) => ({ ...g.group, event: { source: sourceOf(g.key) } }));
    const result = await confirmSheetSuggestions(jobId, withSource(), "accept_all").catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
    setBusy(false);
    if (!result.ok) {
      setDone((was) => new Set([...was].filter((key) => !groups.some((g) => g.key === key))));
      return setError(`${across?.undo ?? `Accept all on sheet ${sheet}`}: ${result.error}`);
    }
    const feet = groups.reduce((n, g) => n + (g.feet ?? 0), 0);
    const { accepted: n, failed, undo } = result.value;
    // ── AFTER ACCEPT ALL: the same printed tags on the other floors, one more click ──
    if (across === undefined) {
      const floorPages = new Set(planSet.filter((r) => r.category === "floor").map((r) => r.pageNumber));
      const taken = new Set(groups.map((g) => g.key));
      const rest = left.filter((item) => !taken.has(item.key));
      const twins = new Map<string, ReturnType<typeof sameOnOtherFloors>[number]>();
      for (const g of groups) {
        const item = left.find((i): i is TypeItem => i.kind === "type" && i.key === g.key);
        if (item === undefined) continue;
        for (const t of sameOnOtherFloors(rest, item, g.group.code, g.group.heightFt, (x, c) => heightOfGroup(x, c)?.feet ?? null, floorPages, planId)) twins.set(t.key, t);
      }
      const codes = new Set([...twins.values()].map((t) => t.group.code));
      setFloorsOffer(twins.size === 0 ? null : { what: codes.size === 1 ? [...codes][0]! : `these ${codes.size} types`, groups: [...twins.values()] });
    }
    const keys = groups.map((g) => g.key);
    const record = { undo, live: true };
    setAccepted({
      text: `${across?.done ?? `Accepted ${n} group${n === 1 ? "" : "s"} on sheet ${sheet}`} · ${Math.round(feet).toLocaleString()} ft${failed.length > 0 ? ` · not accepted: ${failed.join("; ")}` : ""}`,
      keys,
      record,
      known,
    });
    // ── AND ON THE TOOLBAR'S UNDO STACK, beside the one-group accepts ──
    // Chrome on Baker: after Accept all the toolbar Undo stayed grey, and only the
    // inline link could take it back.
    onUndoable?.({
      label: across?.undo ?? `Accept all on ${sheet} (${n} group${n === 1 ? "" : "s"})`,
      undo: async () => {
        if (!record.live) return { ok: true };
        const back = await undoSheetSuggestions(jobId, record.undo).catch(() => ({ ok: false as const, error: "it did not undo. Try it again." }));
        if (!back.ok) return back;
        record.live = false;
        forgetAfter.current = known;
        setAccepted((was) => (was?.record === record ? null : was));
        setDone((done) => new Set([...done].filter((key) => !keys.includes(key))));
        return { ok: true };
      },
      redo: async () => {
        const again = await confirmSheetSuggestions(jobId, withSource(), "accept_all").catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
        if (!again.ok) return again;
        // A fresh token: what the redo wrote is what the next Undo takes back.
        record.undo = again.value.undo;
        record.live = true;
        setDone((was) => new Set([...was, ...keys]));
        return { ok: true };
      },
      inPlace: true,
    });
    router.refresh();
  }
  async function undoAccept() {
    if (accepted === null) return;
    const was = accepted;
    if (!was.record.live) return setAccepted(null);
    setBusy(true);
    const result = await undoSheetSuggestions(jobId, was.record.undo).catch(() => ({ ok: false as const, error: "it did not undo. Try it again." }));
    setBusy(false);
    if (!result.ok) return setError(`Undo: ${result.error}`);
    was.record.live = false;
    forgetAfter.current = was.known;
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
  // ── WHAT AN UNDONE ACCEPT BROUGHT, FORGOTTEN ──
  // Accepting a new type writes its estimate lines, and their prices join the
  // queue; Undo takes the lines away and those items leave `items` — which the
  // count above reads as done ("Prices 2 of 12" after the undos, Chrome on Baker).
  // So an Undo forgets what was first seen after its accept and is gone now.
  const forgetAfter = useRef<Set<string> | null>(null);
  if (forgetAfter.current !== null) {
    const now = new Set(items.map((item) => item.key));
    for (const [part, keys] of seen.current) {
      for (const key of keys) if (!forgetAfter.current.has(key) && !now.has(key)) keys.delete(key);
      if (keys.size === 0) seen.current.delete(part);
    }
  }
  function seenKeys(): Set<string> {
    return new Set([...seen.current.values()].flatMap((keys) => [...keys]));
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

  /**
   * Accept now, save behind: the next item is on screen before the server answers.
   *
   * ── THE UNDO ENTRY JOINS THE STACK AT THE PRESS, NOT AT THE ANSWER ──
   * It used to be pushed when the save came back, so the stack's order was the
   * server's, and an Undo pressed while a save was out could be overtaken by it
   * (Chrome on Baker: two accepts, Undo twice, both still saved after a reload).
   * Pushed here, in the order things were pressed; its Undo waits for the save
   * and reverses exactly what it saved, and its Redo keeps the new token, so a
   * redone accept is undone in full too.
   */
  function acceptNow<R extends { ok: true } | { ok: false; error: string }>(
    key: string,
    what: string,
    run: () => Promise<R>,
    undoable?: { label: string; undo: (saved: Extract<R, { ok: true }>) => Promise<ActionResult>; redo: () => Promise<R> },
  ) {
    setError(null);
    setCursor(after(key));
    setDone((was) => new Set(was).add(key));
    const known = seenKeys();
    forgetAfter.current = null;
    const back = (why: string) => {
      setDone((was) => {
        const next = new Set(was);
        next.delete(key);
        return next;
      });
      setError(`${what}: ${why}`);
    };
    let saved: Promise<Extract<R, { ok: true }> | null> = run().then(
      (result) => {
        if (!result.ok) {
          back(result.error);
          return null;
        }
        return result as Extract<R, { ok: true }>;
      },
      () => {
        back("it did not save. Try it again.");
        return null;
      },
    );
    if (undoable === undefined || onUndoable === undefined) return;
    onUndoable({
      label: undoable.label,
      // ── UNDO PUTS IT BACK, AND THE ITEM BACK IN THE QUEUE ──
      undo: async () => {
        const done = await saved;
        // It never saved (and is back in the queue already): nothing to reverse.
        if (done === null) return { ok: true };
        const undone = await undoable.undo(done);
        if (undone.ok) {
          forgetAfter.current = known;
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
        const again = await undoable.redo();
        if (!again.ok) return again;
        saved = Promise.resolve(again as Extract<R, { ok: true }>);
        setDone((was) => new Set(was).add(key));
        return { ok: true };
      },
      inPlace: true,
    });
  }

  const button = "min-h-[32px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  const primaryButton = "min-h-[32px] rounded-md border border-brand bg-brand px-3 text-xs font-semibold text-neutral-900 disabled:opacity-50";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-card bg-surface px-3 py-1.5 text-xs text-ink-body" data-takeoff="review-queue">
      <span className="font-semibold" data-takeoff="review-queue-left">
        {left.length === 0 ? "Nothing left to review" : `${left.length} left to review`}
      </span>
      {(() => {
        // "312 ft posted automatically · 4 groups need you", and each sheet's auto-posts can be taken back.
        const shown = autoPosted.filter((a) => !undone.has(a.pageNumber));
        const header = queueHeader(shown.reduce((n, a) => n + a.feet, 0), left.filter((item) => item.kind === "type").length, shown.reduce((n, a) => n + (a.doors ?? 0), 0));
        if (header === null) return null;
        return (
          <span className="contents" data-takeoff="review-queue-auto">
            <span>{header}</span>
            {shown.map((a) => (
              <button
                key={a.pageNumber}
                type="button"
                className={button}
                disabled={busy}
                data-takeoff="review-queue-auto-undo"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const result = await undoAutoPost(jobId, planId, a.pageNumber).catch(() => ({ ok: false as const, error: "it did not undo. Try it again." }));
                  setBusy(false);
                  if (!result.ok) return setError(result.error);
                  setUndone((was) => new Set(was).add(a.pageNumber));
                  router.refresh();
                }}
              >
                Undo {a.sheet} ({[a.feet > 0 ? `${Math.round(a.feet)} ft` : null, (a.doors ?? 0) > 0 ? `${a.doors} door${a.doors === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")})
              </button>
            ))}
          </span>
        );
      })()}
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
              <>
              <QueueGroupConfirm
                key={current.key}
                label={`Walls · sheet ${current.sheet}${current.level ? ` · ${current.level.label}` : ""}${current.building ? ` · ${current.building.name.toLowerCase()}` : ""} · ${inchLabel(current.inches)}${current.feet !== null ? ` · ${Math.round(current.feet)} ft` : ""}`}
                codes={
                  current.suggested === null || current.suggested.drawn !== true
                    ? // Nothing on the drawing names this group: the legend's types, closest drawn thickness first, so 1–3 is usually it. Nothing preselected.
                      byThickness(legendCodes, (c) => codeInfo[c.toUpperCase()]?.thicknessIn ?? null, current.inches).map((r) => r.code)
                    : legendCodes.some((c) => c.toUpperCase() === current.suggested!.code.toUpperCase())
                      ? legendCodes
                      : [...legendCodes, current.suggested.code]
                }
                codeDetail={
                  current.suggested?.drawn === true
                    ? undefined
                    : (code) => {
                        const info = codeInfo[code.toUpperCase()];
                        if (info === undefined) return null;
                        return (
                          <span className="ml-1 inline-flex items-center gap-1 align-middle" data-takeoff="queue-code-detail">
                            {info.thicknessIn !== null && <span className="text-ink-muted">{inchLabel(info.thicknessIn)}</span>}
                            {info.crop !== null && info.legendPage !== null && <LegendThumb planId={planId} pageNumber={info.legendPage} crop={info.crop} code={code} />}
                          </span>
                        );
                      }
                }
                suggested={current.suggested}
                missing={legendMissing(legend, jobId)}
                heightOf={(code) => heightOfGroup(current, code)}
                heightOptions={(code) => forCode(heightChoices, code) ?? []}
                onSkip={() => {
                  void recordQueueSkip(jobId, { planId, pageNumber: current.pageNumber, runs: current.runs }).catch(() => undefined);
                  setCursor(after(current.key));
                }}
                rest={unnamed.length > 1 ? `${unnamed.length} groups nothing names on ${current.sheet}${restSpread}` : null}
                onAcceptRest={(code, heightFt, meta) => {
                  rememberHeight(code, heightFt, meta.heightEdited);
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
                onAccept={(code, heightFt, meta) => {
                  rememberHeight(code, heightFt, meta.heightEdited);
                  // The same drawn group on the set's other floor plans, offered once this one is in.
                  const floorPages = new Set(planSet.filter((r) => r.category === "floor").map((r) => r.pageNumber));
                  const same = sameOnOtherFloors(left, current, code!, heightFt, (g, c) => heightOfGroup(g, c)?.feet ?? null, floorPages, planId);
                  setFloorsOffer(same.length === 0 ? null : { what: code!, groups: same });
                  // One group through the sheet's confirm, for the token Undo puts it back with.
                  const group = {
                    planId,
                    pageNumber: current.pageNumber,
                    code: code!,
                    inches: current.inches,
                    runs: current.runs,
                    heightFt,
                    level: levelHeightFor(code, current.level) === null ? null : current.level!.label,
                    // For `TakeoffEvent`: where the pre-filled type came from, and what the person changed.
                    event: { source: current.suggested?.source ?? "none", picked: meta.picked, heightEdited: meta.heightEdited },
                  };
                  const confirmOne = async () => {
                    const result = await confirmSheetSuggestions(jobId, [group]);
                    if (!result.ok) return result;
                    return result.value.accepted === 1 ? result : { ok: false as const, error: result.value.failed[0] ?? "it did not save. Try it again." };
                  };
                  acceptNow(
                    current.key,
                    `${code} on sheet ${current.sheet}`,
                    confirmOne,
                    {
                      label: `Type ${code} on ${current.sheet}`,
                      undo: (saved) => undoSheetSuggestions(jobId, saved.value.undo),
                      // A fresh token: what the redo wrote is what the next Undo takes back.
                      redo: confirmOne,
                    },
                  );
                }}
              />
              {/* What the spec says that changes this type's price, beside the type it is about. */}
              {(() => {
                const code = current.suggested?.code ?? null;
                const line = specSaysLine((code === null ? specSays["*"] : forCode(specSays, code)) ?? []);
                return line === "" ? null : (
                  <span className="basis-full text-xs text-tag-amber-ink" data-takeoff="review-queue-spec-says">
                    {code === null ? line : `${code} · ${line}`}
                  </span>
                );
              })()}
              </>
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
              onSkip={() => {
                void recordQueueSkip(jobId, { planId, pageNumber: current.pageNumber, runs: current.runs }).catch(() => undefined);
                setCursor(after(current.key));
              }}
              onAccept={(_code, heightFt) => {
                if (heightFt === null) return setError("Type a height first: H.");
                const itemId = current.itemId;
                acceptNow(current.key, current.name, () => setWallGroupHeight(jobId, itemId, heightFt), {
                  label: `Height ${heightFt} ft on ${current.name}`,
                  undo: (saved) => undoSheetSuggestions(jobId, { moved: [], created: [], items: [{ id: itemId, heightFt: saved.value.was.heightFt, sides: saved.value.was.sides }] }),
                  redo: () => setWallGroupHeight(jobId, itemId, heightFt),
                });
              }}
            />
          )}
          {current.kind === "windows" && (
            <QueueWindowsConfirm
              key={current.key}
              item={current}
              onShow={onShow}
              onSkip={() => setCursor(after(current.key))}
              onAccept={(kept) => {
                // The same window tags on the set's other floor plans, offered once this sheet is in.
                const floorPages = new Set(planSet.filter((r) => r.category === "floor").map((r) => r.pageNumber));
                const same = sameWindowsOnOtherFloors(left, current, new Set(kept.map((i) => current.tags[i]!)), floorPages);
                setWindowsOffer(same.length === 0 ? null : same);
                // On the same Undo stack as the groups (Chrome on Baker: "Confirm 9" could not be undone).
                const pageNumber = current.pageNumber;
                const confirm = () => confirmWindows(jobId, planId, pageNumber, kept);
                acceptNow(current.key, `windows on sheet ${current.sheet}`, confirm, {
                  label: `Confirm ${kept.length} ${kept.length === 1 ? "window" : "windows"} on ${current.sheet}`,
                  undo: (saved) => undoConfirmWindows(jobId, planId, pageNumber, saved.value.undo),
                  redo: confirm,
                });
              }}
              onUndoable={onUndoable}
            />
          )}
          {current.kind === "scale" &&
            (() => {
              // ── ONE QUESTION FOR THE SET'S UNSCALED FLOOR PLANS (`loadReviewQueue`) ──
              // "Use the printed scale on all N sheets" takes every sheet the plan set can scale
              // in one press (Confirm for the reader's sure ones, the printed scale for the rest);
              // the list keeps each sheet's own fix. The item is done when that press covered
              // every sheet; otherwise it comes back with the ones still to do.
              const pages = current.pages ?? [{ pageNumber: current.pageNumber, sheet: current.sheet }];
              const rowOf = (n: number) => planSet.find((r) => r.pageNumber === n);
              const sure = pages.map((p) => p.pageNumber).filter((n) => rowOf(n)?.confidence === "high" && rowOf(n)?.scaleName != null);
              const printed = pages.map((p) => p.pageNumber).filter((n) => rowOf(n)?.confidence !== "high" && rowOf(n)?.printedFix === true && rowOf(n)?.scaleName != null);
              const oneClick = sure.length + printed.length;
              const scale = async (confirm: number[], usePrinted: number[]): Promise<ActionResult> => {
                if (confirm.length > 0) {
                  const a = await confirmSheetScales(jobId, planId, confirm).catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
                  if (!a.ok) return a;
                }
                if (usePrinted.length > 0) {
                  const b = await confirmSheetScales(jobId, planId, usePrinted, true).catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
                  if (!b.ok) return b;
                }
                return { ok: true };
              };
              const some = async (confirm: number[], usePrinted: number[]) => {
                setBusy(true);
                setError(null);
                const result = await scale(confirm, usePrinted);
                setBusy(false);
                if (!result.ok) return setError(result.error);
                router.refresh();
              };
              return (
                <>
                  <span data-takeoff="review-queue-scale-count">
                    No scale · {pages.length} floor plan{pages.length === 1 ? "" : "s"} the takeoff needs
                  </span>
                  {oneClick > 0 && (
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={busy}
                      data-takeoff="review-queue-scale-all"
                      onClick={() => void (oneClick === pages.length ? decide(() => scale(sure, printed)) : some(sure, printed))}
                    >
                      Use the printed scale on all {oneClick} sheet{oneClick === 1 ? "" : "s"}
                    </button>
                  )}
                  {/* Open when something needs its own fix, and for a short list, which costs nothing to show. */}
                  <details className="w-full" data-takeoff="review-queue-scale-list" open={oneClick < pages.length || pages.length <= 3}>
                    <summary className="cursor-pointer text-ink-muted">The sheets, each with its own fix</summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {pages.map((p) => {
                        const r = rowOf(p.pageNumber);
                        return (
                          <li key={p.pageNumber} className="flex flex-wrap items-center gap-2" data-takeoff="review-queue-scale-sheet" data-page={p.pageNumber}>
                            <span className="font-medium">{p.sheet}</span>
                            <span className="text-ink-muted">{r?.scaleName ?? "no scale read"}</span>
                            {r?.confidence === "high" && r.scaleName !== null && (
                              <button type="button" className={button} disabled={busy} onClick={() => void some([p.pageNumber], [])} data-takeoff="review-queue-confirm-scale">
                                Confirm {r.scaleName}
                              </button>
                            )}
                            {r?.snapDimensions !== undefined && r.scaleName !== null && (
                              <button type="button" className={button} disabled={busy} onClick={() => void some([], [p.pageNumber])} data-takeoff="review-queue-snap">
                                Use {shortScaleName(r.scaleName)} (from {r.snapDimensions} dimensions)
                              </button>
                            )}
                            {r?.confidence !== "high" && r?.printedFix === true && r.scaleName !== null && (
                              <button type="button" className={button} disabled={busy} onClick={() => void some([], [p.pageNumber])} data-takeoff="review-queue-printed">
                                Use the printed scale {r.scaleName}
                              </button>
                            )}
                            <button
                              type="button"
                              className={button}
                              onClick={() => {
                                document.dispatchEvent(new CustomEvent("takeoff-goto", { detail: { page: p.pageNumber } }));
                                document.dispatchEvent(new CustomEvent("takeoff-shortcut", { detail: { key: "s" } }));
                              }}
                              data-takeoff="review-queue-set-scale"
                            >
                              Set it by two clicks
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </>
              );
            })()}
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
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                // Next passes an item undecided: a Skip, recorded like the N key's (`TakeoffEvent`).
                void recordQueueSkip(jobId, { planId, pageNumber: "pageNumber" in current ? current.pageNumber : null, runs: "runs" in current && Array.isArray(current.runs) ? current.runs : [] }).catch(() => undefined);
                setCursor(after(current.key));
              }}
              data-takeoff="review-queue-next"
            >
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
      {(() => {
        // "Apply C6 to 3 other floors (412 ft)": the confirmed group's twins, still open, one click, one Undo.
        if (floorsOffer === null) return null;
        const open = floorsOffer.groups.filter((g) => !done.has(g.key) && left.some((item) => item.key === g.key));
        if (open.length === 0) return null;
        const sheets = open.map((g) => g.sheet).filter((v, i, a) => a.indexOf(v) === i);
        const feet = Math.round(open.reduce((n, g) => n + (g.feet ?? 0), 0));
        const what = `${floorsOffer.what} to ${open.length} more group${open.length === 1 ? "" : "s"} on ${sheets.join(", ")}`;
        return (
          <span className="flex items-center gap-2" data-takeoff="review-queue-floors">
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              data-takeoff="review-queue-floors-apply"
              title={`The same PRINTED tag (or "unless noted" type), same thickness, on ${sheets.join(", ")}. Carried tags and untagged walls are never included.`}
              onClick={() => {
                setFloorsOffer(null);
                void acceptSheet(open, { done: `Applied ${what}`, undo: `Apply ${what}` });
              }}
            >
              Apply {what} ({feet.toLocaleString()} ft)
            </button>
            <button type="button" className="underline" onClick={() => setFloorsOffer(null)} data-takeoff="review-queue-floors-dismiss">
              Not these
            </button>
          </span>
        );
      })()}
      {(() => {
        // "Confirm the same window tags on 2 other floors (14 windows)": each sheet kept whole, one Undo for all.
        if (windowsOffer === null) return null;
        const open = windowsOffer.filter((w) => !done.has(w.key) && left.some((item) => item.key === w.key));
        if (open.length === 0) return null;
        const count = open.reduce((n, w) => n + w.tags.length, 0);
        const what = `the same window tags on ${open.length} other floor${open.length === 1 ? "" : "s"}`;
        async function applyWindows() {
          setWindowsOffer(null);
          setBusy(true);
          setError(null);
          setDone((was) => new Set([...was, ...open.map((w) => w.key)]));
          const saved: { pageNumber: number; undo: Parameters<typeof undoConfirmWindows>[3] }[] = [];
          for (const w of open) {
            const result = await confirmWindows(jobId, planId, w.pageNumber, w.tags.map((_, i) => i)).catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
            if (result.ok) saved.push({ pageNumber: w.pageNumber, undo: result.value.undo });
            else setDone((was) => new Set([...was].filter((key) => key !== w.key)));
          }
          setBusy(false);
          const record = { live: true };
          const undo = async (): Promise<ActionResult> => {
            if (!record.live) return { ok: true };
            for (const one of saved) {
              const back = await undoConfirmWindows(jobId, planId, one.pageNumber, one.undo).catch(() => ({ ok: false as const, error: "it did not undo. Try it again." }));
              if (!back.ok) return back;
            }
            record.live = false;
            setWindowsApplied(null);
            setDone((was) => new Set([...was].filter((key) => !open.some((w) => w.key === key))));
            router.refresh();
            return { ok: true };
          };
          setWindowsApplied({ text: `Confirmed ${what} · ${count} windows`, undo });
          const redo = async (): Promise<ActionResult> => {
            for (const one of saved) {
              const w = open.find((x) => x.pageNumber === one.pageNumber)!;
              const again = await confirmWindows(jobId, planId, one.pageNumber, w.tags.map((_, i) => i)).catch(() => ({ ok: false as const, error: "it did not save. Try it again." }));
              if (!again.ok) return again;
              // A fresh token: what the redo wrote is what the next Undo takes back.
              one.undo = again.value.undo;
            }
            record.live = true;
            setDone((was) => new Set([...was, ...open.map((w) => w.key)]));
            return { ok: true };
          };
          onUndoable?.({ label: `Confirm ${what}`, undo, redo, inPlace: true });
          router.refresh();
        }
        return (
          <span className="flex items-center gap-2" data-takeoff="review-queue-windows-floors">
            <button type="button" className={primaryButton} disabled={busy} data-takeoff="review-queue-windows-floors-apply" onClick={() => void applyWindows()}>
              Confirm the same window tags on {open.length} other floor{open.length === 1 ? "" : "s"} ({count} windows)
            </button>
            <button type="button" className="underline" onClick={() => setWindowsOffer(null)} data-takeoff="review-queue-windows-floors-dismiss">
              Not these
            </button>
          </span>
        );
      })()}
      {windowsApplied !== null && (
        <span className="flex items-center gap-2" data-takeoff="review-queue-windows-applied">
          <span>{windowsApplied.text}</span>
          <button type="button" className="underline" disabled={busy} onClick={() => void windowsApplied.undo().then((r) => (r.ok ? null : setError(`Undo: ${r.error}`)))} data-takeoff="review-queue-windows-applied-undo">
            Undo
          </button>
        </span>
      )}
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
