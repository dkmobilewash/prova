"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KEY_RULES } from "@/lib/takeoff/answerKey";
import {
  candidatesInBox,
  keyFromReview,
  nextUnreviewed,
  progressOf,
  removeTraced,
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
  savedNotice?: string | null;
  /**
   * The reviewer recorded in the file this sheet was restored from.
   *
   * Save is `disabled={savingLabels || reviewer.trim() === ""}`, so a restore
   * that leaves this box empty reopens the sheet with SAVE DEAD — which is
   * exactly what happened on MHK A1.01: the review came back, eleven traces
   * went on, and the button did nothing because a text box three inches away
   * was blank. Nothing about the review was wrong and nothing said so.
   */
  restoredReviewer?: string | null;
  onFocus: (id: string | null) => void;
  /**
   * An unsaved review for this sheet is in the browser — the text to offer.
   *
   * Offered rather than restored behind their back: a reviewer who came back
   * deliberately to start again should not have yesterday applied for them.
   */
  restoreOffer?: string | null;
  onRestore?: () => void;
  onDiscardDraft?: () => void;
  /** Said once the labels are on disk, so the draft can be cleared. */
  onSaved?: () => void;
  /** Storage refused the backup, or a restore was impossible — shown as-is. */
  draftNote?: string | null;
  /** Hide every overlay so the raw drawing can be read. */
  overlaysOn: boolean;
  onOverlays: (on: boolean) => void;
  sheet: { set: string; page: number; number: string; feetPerUnit: number };
  /** What the classifier set aside, by its own reason — see `onSetAside`. */
  setAside?: { kind: string; why: string; n: number }[];
  /** Whether every unpaired line is being offered, and how to change it. */
  offerAll?: boolean;
  onOfferAll?: (next: boolean) => void;
  /** Tracing armed, and how to arm it. A wall the drawing has no candidate
   *  for is drawn on the sheet itself — see `tracing` on the viewer. */
  tracing?: boolean;
  onTracing?: (next: boolean) => void;
  /** Both ends are down, so Enter will commit. */
  traceReady?: boolean;
  /** Split the focused candidate where an accepted wall crosses it. The
   *  workspace owns this because the split needs the sheet's scale. */
  onSplit?: (id: string) => void;
  /** What the last split attempt did, for the reviewer. */
  splitNote?: string | null;
  /**
   * Every pairing the finder considered, with its feature vector.
   *
   * Without these a saved sheet is a score and not training data: the verdicts
   * are about RUNS and a model decides about PAIRINGS, and `labelRows` is what
   * carries one to the other.
   */
  pairings?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    features: number[];
  }[];
};

// The colours live in `answerKeyReview.ts` — a plain module — so that
// anything which is not a browser can read them too. Re-exported here because
// this is where every caller already looks for them.
import { Spinner } from "@/components/Spinner";
import { SINGLE_LINE_COLOUR, VERDICT_COLOURS } from "@/lib/takeoff/answerKeyReview";
export { SINGLE_LINE_COLOUR, VERDICT_COLOURS };

/**
 * A gap longer than this is not work.
 *
 * Six minutes: far longer than any single candidate takes — A101 averaged
 * about ten seconds — and short enough that lunch, a phone call or a tab left
 * open overnight cannot be counted as labelling.
 */
export const IDLE_AFTER_SECONDS = 360;

export function AnswerKeyPanel({
  onSplit,
  splitNote,
  pairings,
  setAside,
  offerAll,
  onOfferAll,
  tracing,
  onTracing,
  traceReady,
  state,
  onState,
  focusedId,
  onFocus,
  savedNotice,
  restoredReviewer,
  restoreOffer,
  onRestore,
  onDiscardDraft,
  onSaved,
  draftNote,
  overlaysOn,
  onOverlays,
  sheet,
}: AnswerKeyPanelProps) {
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [savingLabels, setSavingLabels] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  /**
   * ── TIME SPENT DECIDING, NOT TIME THE TAB WAS OPEN ──
   *
   * This was wall clock from when the sheet opened, on the argument that a
   * figure which flattered the work would be worse than none. It is worse
   * than none in the other direction too: Camp Bow Wow A101 was reviewed in
   * about 24 minutes and the file recorded 135, because the sheet had been
   * open while other things happened. Used to price a job that is 5.6 times
   * too expensive, which is the same mistake the other way round.
   *
   * So: sum the gaps BETWEEN decisions, and ignore any gap longer than
   * `IDLE_AFTER` — nobody spends six minutes on one candidate, and a gap
   * that long is lunch. Loading the sheet and reading the instructions are
   * not counted, which understates a first sheet and is the honest direction
   * to be wrong in when the number prices piecework.
   */
  const spent = useRef({ seconds: 0, last: 0 });
  /**
   * The same number, mirrored so the panel can show it.
   *
   * The ref is the record because it must be exact at the moment of saving;
   * this follows it. No timer: active time only advances when a decision is
   * made, so every value it could take is produced by an event that already
   * re-renders. A ticking clock here would show time passing during a gap
   * that is about to be discarded as idle, which is the opposite of what the
   * number means.
   */
  const [spentSeconds, setSpentSeconds] = useState(0);
  useEffect(() => {
    spent.current = { seconds: 0, last: 0 };
    setSpentSeconds(0);
  }, [sheet.number, sheet.page]);

  /** Called on every verdict. Exported shape kept tiny on purpose. */
  const noteActivity = () => {
    const now = Date.now();
    const gap = (now - spent.current.last) / 1000;
    if (spent.current.last > 0 && gap <= IDLE_AFTER_SECONDS) spent.current.seconds += gap;
    spent.current.last = now;
    setSpentSeconds(spent.current.seconds);
  };
  /**
   * Who is reviewing, typed rather than assumed.
   *
   * A key is a JUDGEMENT and the file records whose. Taking the signed-in user
   * would be convenient and wrong often enough to matter: these sessions get
   * driven from one laptop by whoever is sitting at it.
   */
  const [reviewer, setReviewer] = useState("");

  // ── FILLED ONLY WHEN EMPTY ──
  //
  // Never over a name somebody is typing: this exists to stop Save being dead
  // after a restore, not to decide who the reviewer is.
  useEffect(() => {
    if (restoredReviewer == null || restoredReviewer === "") return;
    setReviewer((current) => (current.trim() === "" ? restoredReviewer : current));
  }, [restoredReviewer]);
  const progress = progressOf(state);
  // A key with no scale is a list of lengths in nothing, and one with no
  // reviewer is a judgement nobody owns. Neither is worth saving.
  const canSave = sheet.feetPerUnit > 0 && reviewer.trim() !== "";

  /**
   * ── EVERY CANDIDATE'S OWN NUMBER, WHICH NOTHING CAN SHIFT ──
   *
   * These rows carried NO number. A reviewer — or a browser agent — therefore
   * referred to them by counting down the visible list, and `shown` is
   * FILTERED: with "unreviewed only" on it shrinks by one every time a
   * decision is made, so "the 31st row" means a different candidate after
   * every keystroke. Meanwhile `nextUnreviewed` walks the FULL
   * `state.candidates` order, so N lands somewhere the visible count does not
   * predict.
   *
   * That cost real work: on STEM A-1.1 and Central Bank A100 the selection
   * ran 1-2 candidates off what was being read out, and on SLN A-101A the
   * panel's numbers sat a consistent +2 from the array index. Fifteen
   * decisions had to be corrected by hand.
   *
   * The number is the candidate's index in `state.candidates`, which is also
   * the index in the saved file's `verdicts`, so a number quoted off the
   * screen means the same thing in the label file and in any audit of it.
   * Filtering the list no longer renumbers anything.
   */
  const numberOf = useMemo(() => {
    const at = new Map<string, number>();
    state.candidates.forEach((c, index) => at.set(c.id, index + 1));
    return at;
  }, [state.candidates]);

  const shown = useMemo(
    () =>
      state.candidates.filter(
        (c) => !unreviewedOnly || (state.verdicts[c.id] ?? "unreviewed") === "unreviewed",
      ),
    [state, unreviewedOnly],
  );

  function decide(id: string | null, verdict: Verdict) {
    noteActivity();
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
      // ── THE ONE MODIFIER SHORTCUT, LET THROUGH BY NAME ──
      //
      // This guard exists so the single-letter keys below cannot fire while a
      // browser shortcut is being pressed. Undo is the exception, because
      // Cmd/Ctrl+Z is the only way anybody expects to spell it.
      //
      // Worth reading as a warning rather than a line of code: the undo
      // branch was written BELOW this guard and was therefore unreachable —
      // dead on arrival, exactly the "written, documented, never called"
      // shape it was added to fix. The smoke test caught it on its first run
      // and nothing else would have.
      const key = event.key.toLowerCase();
      // ⌘Z is NOT handled here. The workspace shell already claims it and
      // routes it to the last trace; a second listener for the same key is
      // two ideas of undo on one screen.
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "a") {
        event.preventDefault();
        decide(focusedId, "wall");
      } else if (key === "r") {
        event.preventDefault();
        decide(focusedId, "not-a-wall");
      } else if (key === "s") {
        // ── S SPLITS WHERE AN ACCEPTED WALL CROSSES ──
        //
        // The case is a wall that stops being a wall part way along: it
        // leaves the building and crosses a yard, a canopy or a slab. Before
        // this the reviewer could only accept the whole thing (billing yard)
        // or reject it (losing real wall) or park it as unsure (losing it
        // either way). See `splitCandidate.ts`.
        //
        // No crossing wall is not a failure — it is the ordinary case for a
        // yard with no wall at its edge, and the reviewer clicks the point
        // instead. The message says so rather than just refusing.
        event.preventDefault();
        if (focusedId !== null && onSplit !== undefined) onSplit(focusedId);
      } else if (key === "u") {
        // ── NOT SURE IS A VERDICT, NOT AN ABSENCE ──
        //
        // It is saved and excluded. A reviewer who cannot call something has
        // told us more than one who skipped it, and feeding either answer to a
        // model teaches a confidence nobody had.
        event.preventDefault();
        decide(focusedId, "unsure");
      } else if (key === "n") {
        event.preventDefault();
        onFocus(nextUnreviewed(state, focusedId)?.id ?? null);
      } else if (key === "h") {
        event.preventDefault();
        onOverlays(!overlaysOn);
      } else if (key === "delete" || key === "backspace") {
        // And the selected one, which is what a reviewer reaches for after
        // clicking the trace they can see is wrong.
        event.preventDefault();
        // ── THROUGH `onState`, WHICH THIS PANEL ALREADY HAS ──
        //
        // The first version added an `onRemoveTraced` prop and wired it
        // through the workspace. It did nothing, and chasing why cost four
        // smoke runs — while `onState` was sitting in the same props object,
        // is how the split handler and every other state change here already
        // work, and needed no new wiring at all.
        if (focusedId !== null && state.traced.some((t) => t.id === focusedId)) {
          onState(removeTraced(state, focusedId));
        }
      } else if (key === "escape") {
        // ── ESC LEAVES TRACE MODE ──
        //
        // T toggles it and did the whole job, which is fine until the mode is
        // armed and the reviewer wants out: every habit says Escape, and
        // pressing T again is the thing they have to be told. Reported as
        // "Esc doesn't reliably leave trace mode (T does)".
        event.preventDefault();
        if (tracing) onTracing?.(false);
        else onFocus(null);
      } else if (key === "t") {
        // ── T ARMS TRACING ──
        //
        // The one thing a reviewer cannot do by deciding about candidates: a
        // wall the drawing shows and the finder never proposed has nothing to
        // accept. Two clicks on the sheet and Enter adds it, already accepted
        // — see `tracedWall`.
        event.preventDefault();
        onTracing?.(!tracing);
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

  /**
   * Writes this sheet's verdicts AND the feature vector of every pairing to
   * the labels folder, through `labelStore`'s own gate.
   *
   * Separate from `save()`, which downloads an answer key — a key says what
   * the walls are, and this says what the finder proposed and what a person
   * made of each one. Only the second is training data.
   */
  async function saveLabels() {
    if (pairings === undefined || pairings.length === 0) {
      setSaved("No pairings were captured, so there is nothing to train on.");
      return;
    }
    setSavingLabels(true);
    try {
      const verdicts = [
        ...state.candidates
          .map((c) => ({ c, v: state.verdicts[c.id] ?? "unreviewed" }))
          .filter((x) => x.v === "wall" || x.v === "not-a-wall" || x.v === "unsure")
          .map((x) => ({
            x1: x.c.x1,
            y1: x.c.y1,
            x2: x.c.x2,
            y2: x.c.y2,
            lengthFeet: x.c.lengthFeet,
            thicknessFeet: (x.c.thicknessIn ?? 0) / 12,
            // "not-wall", not "not-a-wall": `LabelVerdict` spells it the
            // short way and `labelFile` counts rejections by that literal.
            //
            // And "unsure" travels as itself. It did not travel at all once,
            // so every unsure run's pairings reached the file as confident
            // negatives — 483 of them on one sheet.
            verdict: x.v === "wall" ? "wall" : x.v === "unsure" ? "unsure" : "not-wall",
          })),
        ...state.traced.map((t) => ({
          x1: t.x1,
          y1: t.y1,
          x2: t.x2,
          y2: t.y2,
          lengthFeet: t.lengthFeet,
          thicknessFeet: 0,
          verdict: "traced" as const,
        })),
      ];
      const response = await fetch("/api/takeoff/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          set: sheet.set,
          sheet: sheet.number,
          page: sheet.page,
          reviewedBy: reviewer.trim(),
          feetPerUnit: sheet.feetPerUnit,
          secondsSpent: spent.current.seconds,
          // Only a sheet the reviewer finished can say that an unproposed
          // place is NOT a wall — see `labelRows`.
          reviewComplete: progress.reviewed >= progress.total,
          // ── THE COUNT OF WHAT NOBODY LOOKED AT ──
          //
          // This sent `progress.unsure` under the name `unreviewed`, back
          // when they were one number. They are not: unsure is reviewed and
          // excluded, unreviewed is nobody looked. The file now carries both
          // and the second has to be the real one.
          unreviewed: Math.max(0, progress.total - progress.reviewed),
          candidates: pairings,
          verdicts,
        }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; path?: string; rows?: number };
      setSaved(
        body.ok
          ? `Labels saved — ${body.path}`
          : `Not saved: ${body.error ?? "the request failed"}`,
      );
      // ── ONLY AFTER THE FILE IS ON DISK ──
      //
      // The draft is the only copy of this review until the save succeeds, so
      // it is cleared on `ok` and on nothing else — not on the attempt, and
      // not in a `finally`. A 400 must leave the reviewer's work exactly where
      // it was.
      if (body.ok) onSaved?.();
    } catch (cause) {
      setSaved(`Not saved: ${String(cause)}`);
    } finally {
      setSavingLabels(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" data-takeoff="answer-key">
      <div>
        <h2 className="text-sm font-semibold text-ink">Answer key — {sheet.number}</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Nothing counts until you say so. Everything below is a candidate.
        </p>
      </div>

      {/* ── TRACING: THE WALL WITH NO CANDIDATE ON IT ──

          Every other control here decides about something the app proposed.
          This is for the wall it missed, which is the one thing a reviewer
          cannot otherwise record — and a key that cannot hold a missed wall
          grades the detector against its own output. */}
      <div className="rounded-md border border-line-card bg-surface p-2">
        <button
          type="button"
          onClick={() => onTracing?.(!tracing)}
          data-takeoff="key-trace"
          className={
            tracing
              ? "text-[11px] font-medium text-ink"
              : "text-[11px] text-link hover:text-link-hover"
          }
        >
          {tracing ? "Tracing — click both ends" : "Trace a missed wall"}
          <span className="ml-1 text-ink-muted">(t)</span>
        </button>
        {tracing && (
          <p className="mt-1 text-[11px] text-ink-muted" data-takeoff="key-trace-hint">
            {traceReady
              ? "Press Enter to add it as an accepted wall. Escape to start over."
              : "Click the start of the wall, then its end."}
          </p>
        )}
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
        {/*
          * ── THE EXAMPLES GO IN THIS CARD, NOT BESIDE IT ──
          *
          * They were a second card for one render and it was wrong in the way
          * this repository keeps paying for: two lists of what a wall is, on
          * one screen, with different rules in each. `KEY_RULES` is shared
          * with the grader and is the DEFINITION; everything below is worked
          * examples of it, and the moment they are two cards a reviewer has
          * to decide which one governs.
          */}
        <button
          type="button"
          data-takeoff="key-help-toggle"
          aria-expanded={showHelp}
          onClick={() => setShowHelp(!showHelp)}
          className="w-full text-left text-xs font-semibold text-ink-label"
        >
          {showHelp ? "▾" : "▸"} Examples, and what to press
        </button>
        {showHelp ? (
          <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-ink-muted">
            <p>
              Grey is the drawing. Red is what the software proposed. Say yes or no
              to each red line.
            </p>
            <p className="font-semibold text-ink-label">Yes</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Two lines running together, a wall&apos;s thickness apart — one yes for the pair.</li>
              <li>Partitions between rooms, including short returns.</li>
              <li>A wall with a door or window in it. The opening is part of the wall.</li>
              <li>Walls on an enlarged plan — but only mark a wall once across the sheet.</li>
            </ul>
            <p className="font-semibold text-ink-label">No</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Schedules, legends, title blocks — ruled lines inside a box of text.</li>
              <li>Stairs: treads, handrails and the diagonal break. The walls around them are yes.</li>
              <li>The fill inside a wall — stipple, dots, diagonal shading.</li>
              <li>Desks, casework, fixtures. Drawn inside a room, not between two.</li>
              <li>Grid lines and dimension lines.</li>
            </ul>
            {/*
              * ── DIEGO'S RULES, 2026-10-18, AFTER THE FIRST REAL SHEET ──
              *
              * Added because Camp Bow Wow A101 produced 48 "not sure" out of
              * 144, and most of them were one of these five. They are a
              * SCOPE decision rather than a drawing one — the question is
              * what this sub bills for, and nothing in the geometry can
              * answer it — so they have to be written down or every
              * reviewer decides them differently.
              */}
            <p className="font-semibold text-ink-label">
              No — only the building itself counts
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                Site walls OUTSIDE the building: trash enclosures, planters,
                barricades, screen walls, equipment pad edges.
              </li>
              <li>Outdoor yard dividers and fences.</li>
              <li>Kennels, and anything else the owner supplies.</li>
              <li>
                The short &ldquo;bumps&rdquo; where a column crosses a
                wall&apos;s thickness.
              </li>
            </ul>
            <p className="font-semibold text-ink-label">
              A wall that stops being a wall part way along
            </p>
            <p>
              <b>NIC counts.</b> A wall in an area marked <b>NIC</b> or{" "}
              &ldquo;not in contract&rdquo; is still a wall — say so. Whether it
              is in your scope is decided later in the estimate, and a wall left
              out here is invisible to that decision.
            </p>
            <p>
              A wall that continues past the building into a yard, a canopy or a
              slab: press <b>S</b> to <b>split</b> it at the building wall, then
              accept the building half and reject the rest. Splitting beats
              accepting the whole run (which bills the yard) and beats rejecting
              it (which throws away real wall).
            </p>
            <p>
              <b>A candidate that is not quite on the wall.</b> Zoom in before
              accepting a run in a closet or against millwork. If its line is
              paired with a <b>shelf</b>, a shelf end or a counter edge instead
              of the wall&rsquo;s other face, it sits a few inches off the real
              wall — the length looks right and the wall it describes does not
              exist. Same for a double wall where only <b>one layer</b> is
              offered. Press <b>U</b>: it is not a wall as drawn, and it is not
              a clean reject either.
            </p>
            <p>
              <b>Where it cuts.</b> At the nearest wall you have already
              accepted that crosses this one — so accept the building wall
              first. Where no wall crosses, hold <b>shift</b> and click the
              point on the run to cut at. Both halves come back{" "}
              <b>undecided</b>, with their own length, and you judge each one;
              a cut that would leave a stub under a foot is refused. Shift-click
              always cuts the run that is <b>selected</b> — the thick one, whose
              length this panel is showing — not whatever line is under the
              cursor.
            </p>
            <p>
              If you cannot tell, press <b>U</b> for Not sure. That is a real answer
              and better than guessing — a guess teaches the software something false.
            </p>
            <p className="text-ink-label">
              Pictures of each case: open{" "}
              <code className="rounded bg-rail-hover px-1">
                ~/Claude Folder/takeoff/guide/what-counts-as-a-wall.html
              </code>
            </p>
            <p className="font-semibold text-ink-label">Keys</p>
            <p>
              <b>A</b> wall · <b>R</b> not a wall · <b>U</b> not sure · <b>S</b> split ·{" "}
              <b>N</b> next · <b>H</b> hide overlays · <b>T</b> trace a missed wall ·
              drag a box to reject many · shift-drag to accept many
            </p>
          </div>
        ) : null}

      </div>

      {/*
        * ── ONE WALL OFFERED TWICE, SAID OUT LOUD ──
        *
        * The shorter of each pair starts rejected and both halves say so, so
        * a reviewer meets the decision rather than having to notice two
        * near-identical runs among a hundred and forty. On Camp Bow Wow A101
        * one such pair was caught by eye and one was not.
        */}
      {state.duplicates.length > 0 ? (
        <div
          className="rounded-md border border-line-card bg-surface p-2"
          data-takeoff="key-duplicates"
        >
          <p className="text-xs font-semibold text-ink">
            {state.duplicates.length} wall{state.duplicates.length === 1 ? "" : "s"} offered twice
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            The shorter of each pair is already marked <b>not a wall</b>. Accepting
            both would bill the wall twice. Press <b>A</b> on either to change it.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {state.duplicates.map((pair) => {
              const keep = state.candidates.find((c) => c.id === pair.keep);
              const drop = state.candidates.find((c) => c.id === pair.drop);
              if (keep === undefined || drop === undefined) return null;
              return (
                <li key={`${pair.keep}-${pair.drop}`} className="text-[11px] text-ink-body">
                  <button
                    type="button"
                    onClick={() => onFocus(pair.keep)}
                    className="text-link hover:text-link-hover"
                  >
                    {keep.lengthFeet.toFixed(1)} ft
                  </button>{" "}
                  kept ·{" "}
                  <button
                    type="button"
                    onClick={() => onFocus(pair.drop)}
                    className="text-link hover:text-link-hover"
                  >
                    {drop.lengthFeet.toFixed(1)} ft
                  </button>{" "}
                  dropped — {pair.apartFeet < 0.1 ? "on the same line" : `${(pair.apartFeet * 12).toFixed(0)} in apart`},{" "}
                  {(pair.share * 100).toFixed(0)}% shared
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {splitNote !== null && splitNote !== undefined ? (
        <p className="text-[11px] text-ink-muted" data-takeoff="key-split-note">
          {splitNote}
        </p>
      ) : null}

      <div className="rounded-md border border-line-card bg-surface p-2">
        <p className="text-xs text-ink" data-takeoff="key-progress">
          <span className="font-semibold">
            {progress.reviewed} of {progress.total}
          </span>{" "}
          reviewed · {progress.walls} walls · {progress.notWalls} rejected
          {/* Unsure is REVIEWED, so without it the numbers do not add up on
              screen and the reviewer cannot see how many they parked. */}
          {progress.unsure > 0 ? ` · ${progress.unsure} not sure` : ""}
          {progress.traced > 0 ? ` · ${progress.traced} traced` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted" data-takeoff="key-time">
          {progress.feet.toFixed(0)} ft in the key so far ·{" "}
          {/* Active time: the gaps BETWEEN decisions, with anything over six
              minutes dropped as idle. It read 135 minutes for 24 minutes of
              work when it timed the tab instead. */}
          <span title="Time spent deciding. Gaps over six minutes are not counted.">
            {spentSeconds < 60
              ? `${Math.round(spentSeconds)}s`
              : `${Math.floor(spentSeconds / 60)}m ${String(Math.round(spentSeconds % 60)).padStart(2, "0")}s`}{" "}
            spent
          </span>
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
          onClick={() => {
            // Bulk accepts and rejects are work too, and the clock only sees
            // what calls it.
            noteActivity();
            onState(setVerdict(state, shown.map((c) => c.id), "wall"));
          }}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          Accept all shown
        </button>
        <button
          type="button"
          data-takeoff="key-reject-all-shown"
          onClick={() => {
            // Bulk accepts and rejects are work too, and the clock only sees
            // what calls it.
            noteActivity();
            onState(setVerdict(state, shown.map((c) => c.id), "not-a-wall"));
          }}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          Reject all shown
        </button>
        <button
          type="button"
          data-takeoff="key-split"
          disabled={focusedId === null || onSplit === undefined}
          onClick={() => {
            if (focusedId !== null && onSplit !== undefined) onSplit(focusedId);
          }}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50"
        >
          Split (S)
        </button>
        <button
          type="button"
          data-takeoff="key-unsure"
          onClick={() => decide(focusedId, "unsure")}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
        >
          Not sure (U)
        </button>
      </div>

      {/*
        * ── THE INSTRUCTIONS, IN WORDS HERE AND IN PICTURES OUTSIDE THE REPO ──
        *
        * The picture guide is cropped from real plan sets, so it is client
        * drawing content and does not belong in this repository under any
        * filename. It lives beside the labels folder on the machine doing the
        * labelling; this panel carries the rules as text and says where the
        * pictures are.
        */}
      {/* ── AN UNSAVED REVIEW FROM LAST TIME ──
          Above the save button, because it is about the work that is NOT in
          front of them. Offered rather than applied: somebody who came back
          deliberately to start again should not have yesterday restored for
          them. */}
      {/* ── WHAT THE SAVED FILE DID, INCLUDING WHEN IT REFUSED ── */}
      {savedNotice != null && savedNotice !== "" ? (
        <p
          data-takeoff="key-saved-notice"
          className="rounded-md border border-line-card bg-rail-hover px-2 py-1 text-xs text-ink-label"
        >
          {savedNotice}
        </p>
      ) : null}

      {restoreOffer != null && restoreOffer !== "" ? (
        <div
          className="rounded-md border border-brand/60 bg-brand/10 p-2"
          data-takeoff="key-restore"
        >
          <p className="text-[11px] text-ink-label">
            This sheet has an unsaved review in this browser.
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              data-takeoff="key-restore-yes"
              onClick={() => onRestore?.()}
              className="flex-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-neutral-900 hover:bg-yellow-500"
            >
              {restoreOffer}
            </button>
            <button
              type="button"
              data-takeoff="key-restore-no"
              onClick={() => onDiscardDraft?.()}
              className="rounded-md border border-line-card px-2 py-1 text-[11px] text-ink-muted hover:text-ink-label"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
      {draftNote != null && draftNote !== "" ? (
        <p className="text-[11px] text-ink-muted" data-takeoff="key-draft-note">
          {draftNote}
        </p>
      ) : null}
      <div className="rounded-md border border-line-card p-2" data-takeoff="key-labels">
        <button
          type="button"
          data-takeoff="key-save-labels"
          disabled={savingLabels || reviewer.trim() === ""}
          onClick={() => void saveLabels()}
          className="w-full rounded-md bg-brand px-2 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {savingLabels ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Save to labels"
          )}
        </button>
        <p className="mt-1.5 text-[11px] text-ink-muted">
          {pairings === undefined || pairings.length === 0
            ? "No pairings captured yet — run Find the walls first."
            : `${pairings.length} pairings captured · ${progress.reviewed} of ${progress.total} reviewed` +
              (progress.unsure > 0 ? ` · ${progress.unsure} not sure` : "")}
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          Saves what the finder proposed and what you made of each one. Finish the
          sheet before saving: an unreviewed candidate cannot be counted as
          &ldquo;not a wall&rdquo;.
        </p>
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
                data-number={numberOf.get(one.id) ?? ""}
                data-id={one.id}
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
                  <span
                    data-takeoff="key-candidate-number"
                    className="w-8 shrink-0 tabular-nums text-ink-muted"
                  >
                    #{numberOf.get(one.id) ?? "?"}
                  </span>
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
