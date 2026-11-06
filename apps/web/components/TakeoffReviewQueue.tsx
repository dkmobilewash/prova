"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmSheetScales, confirmWallGroup, confirmWindows, priceLineFromCost, reviewWall, setWallGroupHeight } from "@/lib/actions";
import { COST_CATEGORY_LONG_LABEL, COST_CATEGORY_VALUES } from "@/lib/cost-category";
import { QueueGroupConfirm } from "./QueueGroupConfirm";
import { QueueWindowsConfirm } from "./QueueWindowsConfirm";
import { QUEUE_PART, heightFor, type CodeHeight, type ReviewItem } from "@/lib/takeoff/reviewQueue";
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
 * came from, and Enter accepts both (`confirmWallGroup`; `setWallGroupHeight`
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
  planSet,
  onShow,
  onLeft,
  doubted = 0,
  onCheckDoubted,
  onClose,
}: {
  jobId: string;
  planId: string;
  items: ReviewItem[];
  legendCodes: string[];
  /** Each type's height by code (`loadReviewQueue`), for the pre-filled height. */
  heights?: Readonly<Record<string, CodeHeight>>;
  planSet: PlanSetRow[];
  onShow: (item: ReviewItem | null) => void;
  /** Told how many are left whenever that changes, so the top bar's count is this one. */
  onLeft?: (n: number) => void;
  /** Posted walls the model doubts that are not in this queue: Keep/Drop, as a step of it. */
  doubted?: number;
  onCheckDoubted?: () => void;
  onClose: () => void;
}) {
  // Decided here, before the server's re-render drops it from `items`.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<string | null>(null);
  const left = items.filter((item) => !done.has(item.key));
  const current = left.find((item) => item.key === cursor) ?? left[0] ?? null;
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
  function acceptNow(key: string, what: string, run: () => Promise<{ ok: true } | { ok: false; error: string }>) {
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
      (result) => (result.ok ? undefined : back(result.error)),
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
              <span className="text-ink-muted" data-takeoff="review-queue-wall-keys">
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
                label={`Walls · sheet ${current.sheet} · ${inchLabel(current.inches)}${current.feet !== null ? ` · ${Math.round(current.feet)} ft` : ""}`}
                codes={current.suggested === null || legendCodes.some((c) => c.toUpperCase() === current.suggested!.code.toUpperCase()) ? legendCodes : [...legendCodes, current.suggested.code]}
                suggested={current.suggested}
                heightOf={(code) => heightFor(code, heights, current.ceiling)}
                onSkip={() => setCursor(after(current.key))}
                onAccept={(code, heightFt) =>
                  acceptNow(current.key, `${code} on sheet ${current.sheet}`, () =>
                    confirmWallGroup(jobId, { planId, pageNumber: current.pageNumber, code: code!, inches: current.inches, runs: current.runs, heightFt }),
                  )
                }
              />
            ))}
          {current.kind === "height" && (
            <QueueGroupConfirm
              key={current.key}
              label={`No height · ${current.name} · sheet ${current.sheet}${current.feet !== null ? ` · ${Math.round(current.feet)} ft` : ""}`}
              codes={[]}
              suggested={null}
              heightOf={() => {
                // The type's own height first, as for a group being typed; else the ceiling.
                const first = current.options.find((o) => o.kind === "legend") ?? current.options[0];
                return first === undefined ? null : { feet: first.feet, from: first.from };
              }}
              onSkip={() => setCursor(after(current.key))}
              onAccept={(_code, heightFt) => {
                if (heightFt === null) return setError("Type a height first: H.");
                acceptNow(current.key, current.name, () => setWallGroupHeight(jobId, current.itemId, heightFt));
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
      {priced !== null && error === null && (
        <span className="text-ink-muted" data-takeoff="review-queue-priced">
          {priced}
        </span>
      )}
      {error !== null && <span className="text-tag-amber-ink">{error}</span>}
    </div>
  );
}
