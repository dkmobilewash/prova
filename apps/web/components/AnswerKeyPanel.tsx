"use client";

import { useEffect, useMemo, useState } from "react";
import { KEY_RULES } from "@/lib/takeoff/answerKey";
import {
  candidatesInBox,
  keyFromReview,
  nextUnreviewed,
  progressOf,
  setVerdict,
  type ReviewState,
  type Verdict,
} from "@/lib/takeoff/answerKeyReview";

/**
 * ── MAKING AN ANSWER KEY FOR ONE REAL SHEET ──
 *
 * Every accuracy number in this repo comes from a plan it drew itself. This is
 * the screen that produces the other kind: one person's reviewed answer for a
 * sheet somebody actually issued, which is the only thing that can turn
 * "2,099 ft on A102" into a measurement with an error bar.
 *
 * ── NOTHING IS ACCEPTED UNTIL IT IS ACCEPTED ──
 *
 * The detection is pre-loaded and every row of it is a CANDIDATE. The
 * alternative — pre-accepting and letting the reviewer delete — makes a key
 * that agrees with the detector by construction, because nobody deletes a
 * hundred rows one at a time. `answerKeyReview.ts` holds that rule and is
 * tested at every transition.
 */

export type AnswerKeyPanelProps = {
  state: ReviewState;
  onState: (next: ReviewState) => void;
  /** Which candidate the overlay is highlighting, if any. */
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  /** Hide every overlay so the raw drawing can be read. */
  overlaysOn: boolean;
  onOverlays: (on: boolean) => void;
  sheet: { set: string; page: number; number: string; feetPerUnit: number };
  /** What the classifier set aside, by its own reason — see `onSetAside`. */
  setAside?: { kind: string; why: string; n: number }[];
  /** Whether every unpaired line is being offered, and how to change it. */
  offerAll?: boolean;
  onOfferAll?: (next: boolean) => void;
};

// The colours live in `answerKeyReview.ts` — a plain module — so that
// anything which is not a browser can read them too. Re-exported here because
// this is where every caller already looks for them.
import { SINGLE_LINE_COLOUR, VERDICT_COLOURS } from "@/lib/takeoff/answerKeyReview";
export { SINGLE_LINE_COLOUR, VERDICT_COLOURS };

export function AnswerKeyPanel({
  setAside,
  offerAll,
  onOfferAll,
  state,
  onState,
  focusedId,
  onFocus,
  overlaysOn,
  onOverlays,
  sheet,
}: AnswerKeyPanelProps) {
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  /**
   * Who is reviewing, typed rather than assumed.
   *
   * A key is a JUDGEMENT and the file records whose. Taking the signed-in user
   * would be convenient and wrong often enough to matter: these sessions get
   * driven from one laptop by whoever is sitting at it.
   */
  const [reviewer, setReviewer] = useState("");
  const progress = progressOf(state);
  // A key with no scale is a list of lengths in nothing, and one with no
  // reviewer is a judgement nobody owns. Neither is worth saving.
  const canSave = sheet.feetPerUnit > 0 && reviewer.trim() !== "";

  const shown = useMemo(
    () =>
      state.candidates.filter(
        (c) => !unreviewedOnly || (state.verdicts[c.id] ?? "unreviewed") === "unreviewed",
      ),
    [state, unreviewedOnly],
  );

  function decide(id: string | null, verdict: Verdict) {
    if (id === null) return;
    const next = setVerdict(state, [id], verdict);
    onState(next);
    // Straight to the next undecided one: a reviewer pressing A, A, A should
    // move through the sheet without reaching for the mouse, which is the
    // whole reason this mode exists rather than a spreadsheet.
    onFocus(nextUnreviewed(next, id)?.id ?? null);
  }

  // ── KEYBOARD, BECAUSE A HUNDRED DECISIONS IS A LOT OF CLICKING ──
  //
  // A / R / N, and only when nothing is being typed into — the same guard the
  // workspace's own shortcuts use, or a reviewer typing a filename would
  // accept a wall with every "a".
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        decide(focusedId, "wall");
      } else if (key === "r") {
        event.preventDefault();
        decide(focusedId, "not-a-wall");
      } else if (key === "n") {
        event.preventDefault();
        onFocus(nextUnreviewed(state, focusedId)?.id ?? null);
      } else if (key === "h") {
        event.preventDefault();
        onOverlays(!overlaysOn);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function save() {
    const key = keyFromReview(state, {
      set: sheet.set,
      page: sheet.page,
      number: sheet.number,
      reviewedBy: reviewer.trim(),
      reviewedAt: new Date().toISOString(),
      feetPerUnit: sheet.feetPerUnit,
    });
    // ── A DOWNLOAD, BECAUSE THE KEY MUST NOT LAND IN THE REPOSITORY ──
    //
    // The sheets are a client's drawings and a key is derived from one, so it
    // is treated the same way: it goes to the reviewer's own machine, into
    // whatever folder `REAL_PLAN_KEYS` points at. A server write would have to
    // be given a path, and a web request that writes a path is a worse idea
    // than a file somebody saves deliberately.
    // ── THE NAME IS SHOWN, BECAUSE IT IS NOT THE ONE ANYBODY EXPECTS ──
    //
    // `sheet.number` is the sheet number where the set has been through the
    // title-block stage, and `p15` where it has not — that stage calls a
    // model, so a locally-ingested set has no sheet numbers at all. A
    // reviewer who has spent an hour on A120 then goes looking for
    // `A120.key.json` and there is no such file. Saying the name here costs a
    // line and removes the whole question.
    const filename = `${sheet.number.replace(/[^A-Za-z0-9_.-]+/g, "_")}.key.json`;
    const blob = new Blob([JSON.stringify(key, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // ATTACHED BEFORE THE CLICK, and the object URL released on a timer
    // rather than on the next line. A detached anchor works in Chromium and
    // is not portable, and revoking synchronously races the browser's own
    // read of the blob. Measured in real Chromium: the shipped form does
    // produce the file, so this is insurance rather than a fix — which is
    // exactly why it is written down and not quietly changed.
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSaved(`${filename} — ${key.walls.length} walls, ${progress.feet.toFixed(0)} ft`);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" data-takeoff="answer-key">
      <div>
        <h2 className="text-sm font-semibold text-ink">Answer key — {sheet.number}</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Nothing counts until you say so. Everything below is a candidate.
        </p>
      </div>

      {/* ── WHAT WAS SET ASIDE, AND HOW TO SEE IT ANYWAY ──

          Only the lines the classifier could say nothing about are offered,
          which took A102 from 168 possible walls to 2. The rest are not gone
          and must not look gone: a reviewer who cannot tell that the app
          decided for them is reviewing the app's opinion rather than the
          drawing, and a key made that way grades the detector against itself.

          So the count is on screen with its reasons, and the override is
          beside it. */}
      {(setAside?.length ?? 0) > 0 && (
        <div
          className="rounded-md border border-line-card bg-surface p-2"
          data-takeoff="key-set-aside"
        >
          <p className="text-[11px] text-ink-body">
            {setAside!.reduce((n, one) => n + one.n, 0)} line
            {setAside!.reduce((n, one) => n + one.n, 0) === 1 ? "" : "s"} set aside:{" "}
            {setAside!.map((one) => `${one.n} ${one.kind.replace(/-/g, " ")}`).join(", ")}.
          </p>
          <button
            type="button"
            onClick={() => onOfferAll?.(!offerAll)}
            data-takeoff="key-offer-all"
            className="mt-1 text-[11px] text-link hover:text-link-hover"
          >
            {offerAll ? "Offer only the unexplained ones" : "Offer these too"}
          </button>
        </div>
      )}

      {/* ── WHAT COUNTS, IN THE REVIEWER'S OWN TERMS ──
          On screen rather than in a document, because a key made under one
          definition and graded under another is worse than no key. The same
          strings the grader is documented with — see `KEY_RULES`. */}
      <div className="rounded-md border border-line-card bg-surface p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          What counts as a wall
        </p>
        <ul className="flex flex-col gap-0.5">
          {KEY_RULES.map((rule) => (
            <li key={rule} className="text-[11px] leading-snug text-ink-body">
              {rule}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-line-card bg-surface p-2">
        <p className="text-xs text-ink" data-takeoff="key-progress">
          <span className="font-semibold">
            {progress.reviewed} of {progress.total}
          </span>{" "}
          reviewed · {progress.walls} walls · {progress.notWalls} rejected
          {progress.traced > 0 ? ` · ${progress.traced} traced` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {progress.feet.toFixed(0)} ft in the key so far
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-takeoff="key-unreviewed-only"
          aria-pressed={unreviewedOnly}
          onClick={() => setUnreviewedOnly(!unreviewedOnly)}
          className={`rounded-md border px-2 py-1 text-xs ${
            unreviewedOnly
              ? "border-brand bg-brand text-neutral-900"
              : "border-line-card text-ink-label hover:bg-rail-hover"
          }`}
        >
          Unreviewed only
        </button>
        <button
          type="button"
          data-takeoff="key-overlays"
          aria-pressed={!overlaysOn}
          onClick={() => onOverlays(!overlaysOn)}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          {overlaysOn ? "Hide overlays" : "Show overlays"}
        </button>
        <button
          type="button"
          data-takeoff="key-accept-all-shown"
          onClick={() => onState(setVerdict(state, shown.map((c) => c.id), "wall"))}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          Accept all shown
        </button>
        <button
          type="button"
          data-takeoff="key-reject-all-shown"
          onClick={() => onState(setVerdict(state, shown.map((c) => c.id), "not-a-wall"))}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          Reject all shown
        </button>
      </div>

      <p className="text-[11px] text-ink-muted">
        <span className="font-semibold text-ink-body">A</span> wall ·{" "}
        <span className="font-semibold text-ink-body">R</span> not a wall ·{" "}
        <span className="font-semibold text-ink-body">N</span> next ·{" "}
        <span className="font-semibold text-ink-body">H</span> hide overlays · drag a box on the
        sheet to decide many at once
      </p>

      <ul className="flex flex-col gap-1">
        {shown.map((one) => {
          const verdict = state.verdicts[one.id] ?? "unreviewed";
          return (
            <li key={one.id}>
              <button
                type="button"
                data-takeoff="key-candidate"
                data-verdict={verdict}
                onClick={() => onFocus(one.id)}
                className={`flex w-full items-baseline justify-between gap-2 rounded-md border px-2 py-1 text-left text-xs ${
                  focusedId === one.id
                    ? "border-brand bg-rail-hover"
                    : "border-line-card hover:bg-rail-hover"
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background:
                        one.from === "single" && verdict === "unreviewed"
                          ? SINGLE_LINE_COLOUR
                          : VERDICT_COLOURS[verdict],
                    }}
                  />
                  <span className="font-medium text-ink">{one.lengthFeet.toFixed(0)} ft</span>
                  <span className="text-ink-muted">
                    {one.from === "pair"
                      ? `${one.thicknessIn === null ? "?" : one.thicknessIn.toFixed(1)}in`
                      : "single line"}
                  </span>
                </span>
                <span className="shrink-0 text-ink-muted">{one.note}</span>
              </button>
              {focusedId === one.id && (
                <div className="mt-1 flex gap-1 pl-4">
                  <button
                    type="button"
                    data-takeoff="key-accept"
                    onClick={() => decide(one.id, "wall")}
                    className="rounded border border-line-card px-2 py-0.5 text-[11px] text-ink-label hover:bg-rail-hover"
                  >
                    Wall (A)
                  </button>
                  <button
                    type="button"
                    data-takeoff="key-reject"
                    onClick={() => decide(one.id, "not-a-wall")}
                    className="rounded border border-line-card px-2 py-0.5 text-[11px] text-ink-label hover:bg-rail-hover"
                  >
                    Not a wall (R)
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="rounded-md border border-line-card bg-surface px-2 py-3 text-center text-xs text-ink-muted">
            {unreviewedOnly ? "Everything here has been reviewed." : "Nothing to review on this sheet."}
          </li>
        )}
      </ul>

      <div className="mt-auto border-t border-line-card pt-2">
        <label className="mb-2 block text-[11px] text-ink-muted">
          Reviewed by
          <input
            type="text"
            // NAMED, because `numericInputCensus` treats an input whose name it
            // cannot read as possibly numeric — an unreadable name is not
            // evidence of a text box. It is also just correct: a form control
            // with no name is one nothing can refer to.
            name="reviewedBy"
            data-takeoff="key-reviewer"
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="your name"
            className="mt-0.5 w-full rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink"
          />
        </label>
        <button
          type="button"
          data-takeoff="key-save"
          onClick={save}
          disabled={!canSave}
          className="w-full rounded-md bg-brand px-3 py-2 text-sm font-semibold text-neutral-900 hover:opacity-90 disabled:opacity-40"
        >
          Save as answer key
        </button>
        {!canSave && (
          <p className="mt-1 text-[11px] text-ink-muted" data-takeoff="key-cannot-save">
            {sheet.feetPerUnit > 0
              ? "Put your name in first — a key records whose judgement it is."
              : "This sheet has no scale yet, so there is nothing to measure against."}
          </p>
        )}
        <p className="mt-1 text-[11px] text-ink-muted">
          Downloads a JSON file. Put it in the folder <code>REAL_PLAN_KEYS</code> points at — it must
          not go into the repository.
        </p>
        {saved !== null && (
          <p className="mt-1 text-[11px] text-ink-body" data-takeoff="key-saved">
            Saved {saved}.
          </p>
        )}
      </div>
    </div>
  );
}

/** Re-exported so the viewer's box-select can reach it without a second path. */
export { candidatesInBox };
