"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmSheetScales, confirmWallGroup, reviewWall, setWallGroupHeight } from "@/lib/actions";
import { QueueGroupConfirm } from "./QueueGroupConfirm";
import { heightFor, type CodeHeight, type ReviewItem } from "@/lib/takeoff/reviewQueue";
import type { PlanSetRow } from "@/lib/takeoff/planSet";
import { inchLabel } from "@/lib/takeoff/wallVectors";

/**
 * ── THE JOB'S ONE REVIEW QUEUE, ONE ITEM AT A TIME ──
 *
 * What the stepper's Review opens (`?open=review`). The item on screen is
 * zoomed to on its sheet by the workspace (`onShow`); its buttons are the
 * pieces that already decide it — `reviewWall` for a held run, the plan set's
 * fixes for a sheet's scale, and the estimate line itself for a price.
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
  onClose: () => void;
}) {
  // Decided here, before the server's re-render drops it from `items`.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = items.filter((item) => !done.has(item.key));
  const current = left.find((item) => item.key === cursor) ?? left[0] ?? null;
  const after = (key: string) => {
    const at = left.findIndex((item) => item.key === key);
    return left.length < 2 ? null : left[(at + 1) % left.length]!.key;
  };

  // A price is set on the estimate, in its own tab: coming back reads the queue again.
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
  const row = current !== null && current.kind === "scale" ? planSet.find((r) => r.pageNumber === current.pageNumber) : undefined;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-card bg-surface px-3 py-1.5 text-xs text-ink-body" data-takeoff="review-queue">
      <span className="font-semibold" data-takeoff="review-queue-left">
        {left.length === 0 ? "Nothing left to review" : `${left.length} left to review`}
      </span>
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
            </>
          )}
          {current.kind === "type" &&
            (legendCodes.length === 0 && current.suggested === null ? (
              <>
                <span>
                  Untyped walls · sheet {current.sheet} · {inchLabel(current.inches)}
                </span>
                <span className="text-ink-muted">This set&rsquo;s legend names no types: choose one in the sheet&rsquo;s group list.</span>
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
          {current.kind === "price" && (
            <>
              <span>
                No price · {current.description} · {current.quantity} {current.unit ?? ""}
              </span>
              <a href={`/jobs/${jobId}/estimate?line=${current.lineItemId}#line-${current.lineItemId}`} target="_blank" rel="noreferrer" onClick={() => (pricing.current = true)} className={button + " inline-flex items-center"} data-takeoff="review-queue-line">
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
      <button type="button" className="underline" onClick={onClose} data-takeoff="review-queue-close">
        Close
      </button>
      {error !== null && <span className="text-tag-amber-ink">{error}</span>}
    </div>
  );
}
