"use client";

import { useEffect, useRef, useState } from "react";
import {
  EXAMPLE_CAPTION,
  HOURS,
  HOURS_OUTCOME,
  HOURS_PREVIEW,
  PRODUCT_COPY,
  RFI,
  RFI_PREVIEW,
  TOTAL_MS,
  finalFrame,
  frameAt,
  frameKey,
  sceneDescription,
  type Frame,
} from "./askDemoScript";

/**
 * A twenty-second scene of Ask C Stream doing two real tasks, for the
 * public landing page. The script — every word, every duration — is in
 * askDemoScript.ts and its header says what the scene may and may not
 * show; this file only draws a frame of it and keeps one clock.
 *
 * DRAWN TO MATCH THE PRODUCT, NOT TO LOOK LIKE IT. The class strings below
 * are AskLauncher.tsx's dialog, AskPanel.tsx's box and status line,
 * AskProposalCard.tsx's card and buttons, RfiForm.tsx's form and RfiRow.tsx's
 * row — the same tokens, the same geometry (44px buttons, Cancel first,
 * the primary last and right-pinned, the brand fill with a dark label and
 * never white). If the panel is restyled, restyle this with it.
 *
 * ONE CLOCK. `requestAnimationFrame` advances `t`; the frame is `frameAt(t)`,
 * and state is set only when `frameKey` changes, so React renders on the
 * instants something visible happens rather than sixty times a second.
 * Pausing stops the loop and holds `t`; unmounting cancels the one pending
 * request and disconnects the one observer. A tick after a long gap (a
 * tab in the background) is clamped, so coming back does not skip the
 * scene forward.
 *
 * STARTS WHEN SEEN, STOPS WHEN NOT. An IntersectionObserver plays the scene
 * as it scrolls into view and pauses it off-screen, so a phone is not
 * spending its battery on a demo nobody is looking at. A person's own tap
 * on Pause sticks: scrolling away and back does not restart something they
 * stopped. WCAG 2.2.2 wants a visible way to pause anything that moves
 * for more than five seconds, and the button is that — on screen, 44px,
 * labelled, keyboard-reachable.
 *
 * SAFE AT REST, THE WAY Reveal.tsx AND FactTicker.tsx ARE. The server
 * render, a browser with no JavaScript and a reader who asked for reduced
 * motion all get the same thing: one still frame of the scene, the hours
 * card settled, read off the schedule. The moving layer exists only after
 * mount and only when `prefers-reduced-motion` is not `reduce`, so
 * hydration matches the server byte for byte and nothing can move for
 * someone who asked it not to. The still frame is a real frame, not a
 * separate drawing, so it cannot drift from the scene.
 *
 * FOR A SCREEN READER. The stage is aria-hidden in both modes — typing
 * announced a character at a time is noise, and a still picture of a card
 * is not a sentence — and a visually hidden paragraph describes the scene
 * once, built from the same script data. The pause button stays in the
 * accessibility tree.
 *
 * No dependency, no video, no image: markup, Tailwind classes and two
 * inline SVGs. It fits 320px because nothing in it is wider than a word.
 */

/** AskProposalCard.tsx PRIMARY, plus `relative` for the tap indicator. */
const PRIMARY =
  "relative inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-base font-semibold text-neutral-900";
const PRIMARY_PRESSED = "bg-yellow-500 scale-95";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-base text-ink-body";

/** RfiFields.tsx fieldInputClass, restated as a read-only box. */
const FIELD = "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink";

function Sparkle() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M10 2.5 11.6 7l4.4 1.6L11.6 10 10 14.5 8.4 10 4 8.6 8.4 7 10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Paperclip() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M13.5 6.5 7.8 12.2a1.5 1.5 0 0 0 2.1 2.1l6-6a3 3 0 0 0-4.2-4.2l-6.2 6.2a4.5 4.5 0 0 0 6.4 6.4l5-5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The tap. A fingertip-sized ring over the button's centre, and on the
 * press instant a ripple (`animate-ping`) so the eye reads a tap rather
 * than a button that changed colour by itself. Absolutely positioned
 * inside the button, so it needs no measuring and lands right at any
 * width. */
function Tap({ pressed }: { pressed: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-ask-demo="tap"
      className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2"
    >
      {pressed && <span className="absolute inset-0 rounded-full border-2 border-ink motion-safe:animate-ping" />}
      <span
        className={`absolute inset-0 rounded-full border-2 border-ink bg-ink/25 transition-transform duration-150 ${
          pressed ? "scale-75" : "scale-100"
        }`}
      />
    </span>
  );
}

/** AskProposalCard.tsx, for one of the two commands, in the state the
 * frame asks for. Handoff or direct is decided by which task it is, the
 * same way the real card decides by `proposal.handoffHref`. */
function Card({ frame }: { frame: Frame }) {
  const rfi = frame.task === 1;
  const settled = frame.card === "settled";
  const pending = frame.card === "pending";
  const pressed = frame.card === "pressed";
  const preview = rfi ? RFI_PREVIEW : HOURS_PREVIEW;
  const title = rfi ? RFI.title : HOURS.title;
  const button = rfi ? RFI.button : HOURS.button;

  return (
    <div className="mt-3 rounded-lg border border-line-card bg-canvas p-3" data-ask-demo="card">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-label">
        {settled ? PRODUCT_COPY.done : title}
      </p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {preview.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-ink-body">{line.label}</dt>
            <dd className="min-w-0 break-words text-ink">{line.value}</dd>
          </div>
        ))}
      </dl>

      {rfi && (
        <ul className="mt-2 text-xs text-tag-amber-ink">
          <li>{RFI.warning}</li>
        </ul>
      )}

      {rfi && !settled && <p className="mt-2 text-xs text-ink-body">{PRODUCT_COPY.handoffNote}</p>}

      {settled && (
        <p className="mt-2 text-sm text-ink" data-ask-demo="outcome">
          <span className="font-medium underline">{HOURS_OUTCOME.createdLabel}</span> {HOURS_OUTCOME.message}
        </p>
      )}

      {!settled && (
        <div className="mt-3 flex justify-end gap-2">
          <span className={`${SECONDARY} ${pending ? "opacity-50" : ""}`}>{PRODUCT_COPY.cancel}</span>
          <span
            data-ask-demo="primary"
            data-pressed={pressed ? "true" : undefined}
            className={`${PRIMARY} transition-[transform,background-color] duration-150 ${
              pressed ? PRIMARY_PRESSED : ""
            } ${pending ? "opacity-50" : ""}`}
          >
            {pending ? PRODUCT_COPY.working : button}
            {frame.tap === "primary" && <Tap pressed={pressed} />}
          </span>
        </div>
      )}
    </div>
  );
}

/** RfiForm.tsx as the handoff opens it: the fields the card filled in,
 * the sent date blank, and the form's own Save. */
function RfiForm({ frame }: { frame: Frame }) {
  const pressed = frame.form === "pressed";
  const saving = frame.form === "saving";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4" data-ask-demo="form">
      <h3 className="text-sm font-semibold text-ink-label">{PRODUCT_COPY.rfiFormTitle}</h3>
      <div className="flex flex-col gap-1 text-sm text-ink-label">
        Job
        <div className={`${FIELD} truncate`}>{RFI.jobPickerLabel}</div>
      </div>
      <div className="flex flex-col gap-1 text-sm text-ink-label">
        Subject
        <div className={`${FIELD} truncate`}>{RFI.subject}</div>
      </div>
      <div className="flex flex-col gap-1 text-sm text-ink-label">
        Question
        <div className={FIELD}>{RFI.question}</div>
      </div>
      <div className="flex flex-col gap-1 text-sm text-ink-label">
        Date sent
        <div className={FIELD} />
        <span className="text-xs text-ink-body">{PRODUCT_COPY.blankKeepsDraft}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <span
          data-ask-demo="save"
          data-pressed={pressed ? "true" : undefined}
          className={`relative inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-[transform,background-color] duration-150 ${
            pressed ? PRIMARY_PRESSED : ""
          } ${saving ? "opacity-50" : ""}`}
        >
          {saving ? PRODUCT_COPY.savingRfi : PRODUCT_COPY.saveRfi}
          {frame.tap === "save" && <Tap pressed={pressed} />}
        </span>
        <span className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label">
          {PRODUCT_COPY.cancel}
        </span>
      </div>
    </div>
  );
}

/** RfiRow.tsx, the row the save produced: number, subject, the Draft
 * chip a row with no sent date carries, and the question under it. */
function RfiSaved() {
  return (
    <div className="rounded-lg border border-line-card bg-surface" data-ask-demo="saved">
      <p className="border-b border-line-row px-4 py-2 text-sm font-semibold text-ink">RFIs</p>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-body">RFI {RFI.number}</span>
          <span className="text-ink">{RFI.subject}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">{PRODUCT_COPY.draft}</span>
        </div>
        <p className="mt-1 text-sm text-ink-label">{RFI.question}</p>
      </div>
    </div>
  );
}

/** AskPanel.tsx: the live exchange above the box, and the box. */
function Panel({ frame }: { frame: Frame }) {
  return (
    <div className="rounded-lg border border-line-card bg-surface p-4" data-ask-demo="panel">
      {frame.asked && (
        <div className="mb-3">
          <p className="text-sm font-medium text-ink-label">{frame.asked}</p>
          {frame.status && (
            <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink-body" data-ask-demo="status">
              {frame.status}
            </p>
          )}
          {frame.card !== "none" && <Card frame={frame} />}
        </div>
      )}

      <div className="flex gap-2">
        {/* The box. A real <input> scrolls to keep the caret in view as a
            long question is typed; this is a div, so it is laid out
            right-to-left with the text itself left-to-right — overflow
            then spills off the LEFT edge and is clipped, keeping the
            caret at the right, which is what an input does. Short text
            still sits at the left, because text-align says so. */}
        <div
          dir="rtl"
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap rounded-md border border-line-card bg-surface px-3 py-2 text-left text-sm text-ink"
          data-ask-demo="box"
        >
          {frame.typed ? (
            <span dir="ltr" className="inline-block">
              {frame.typed}
              {frame.caret && <Caret />}
            </span>
          ) : (
            <span dir="ltr" className="inline-block text-ink-muted">
              {frame.caret && <Caret />}
              {PRODUCT_COPY.placeholder}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded-md border border-line-card bg-surface px-3 py-2 text-ink-body">
          <Paperclip />
        </span>
        <span
          className={`shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition-[transform,background-color] duration-150 ${
            frame.askPressed ? PRIMARY_PRESSED : ""
          } ${frame.typed === "" && frame.asked === null ? "opacity-50" : ""} ${
            frame.asked !== null && frame.status !== null ? "opacity-50" : ""
          }`}
        >
          {frame.status !== null ? PRODUCT_COPY.asking : PRODUCT_COPY.ask}
        </span>
      </div>
    </div>
  );
}

function Caret() {
  return <span aria-hidden="true" className="ml-px inline-block h-4 w-px bg-ink align-middle motion-safe:animate-pulse" />;
}

/** One instant of the scene, drawn. */
function Stage({ frame }: { frame: Frame }) {
  if (frame.view === "form") return <RfiForm frame={frame} />;
  if (frame.view === "saved") return <RfiSaved />;
  return <Panel frame={frame} />;
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <rect x="5" y="4" width="3.5" height="12" rx="1" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path d="M6 4.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

/** How much of the stage must be on screen before the scene plays. */
const VISIBLE_RATIO = 0.35;
/** The longest single tick the clock will credit: a tab that was in the
 * background for a minute resumes where it paused, not a minute on. */
const MAX_TICK_MS = 100;

/**
 * The moving layer. Mounted only after hydration and only without
 * `prefers-reduced-motion: reduce` — see AskDemo below.
 */
function Player() {
  const [frame, setFrame] = useState<Frame>(() => frameAt(0));
  const [playing, setPlaying] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const keyRef = useRef(frameKey(frameAt(0)));
  /** The person pressed Pause themselves; scrolling must not undo it. */
  const heldRef = useRef(false);
  const inViewRef = useRef(false);

  // Start when seen, stop when not.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No observer: nothing can tell us it is on screen, so play. A
      // scene that never starts is the vacuous failure Reveal.tsx guards
      // against, in a stopwatch's clothes.
      setPlaying(!heldRef.current);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        inViewRef.current = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
        setPlaying(inViewRef.current && !heldRef.current);
      },
      { threshold: [0, VISIBLE_RATIO] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The one clock.
  useEffect(() => {
    if (!playing) return;
    let request = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(MAX_TICK_MS, Math.max(0, now - last));
      last = now;
      tRef.current = (tRef.current + dt) % TOTAL_MS;
      // The clock's reading, written straight to the DOM every tick rather
      // than through state: React renders only when the frame changes, so
      // an attribute set in JSX would lag behind the clock by up to a whole
      // step — and a test that read it would be measuring the render, not
      // the clock (CLAUDE.md's vacuous-watcher rule).
      stageRef.current?.setAttribute("data-ask-demo-t", String(Math.round(tRef.current)));
      const next = frameAt(tRef.current);
      const key = frameKey(next);
      if (key !== keyRef.current) {
        keyRef.current = key;
        setFrame(next);
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing]);

  function toggle() {
    if (playing) {
      heldRef.current = true;
      setPlaying(false);
    } else {
      heldRef.current = false;
      setPlaying(true);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line-row px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-body" aria-hidden="true">
          <Sparkle />
          Ask C Stream
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={!playing}
          aria-label={playing ? "Pause the example" : "Play the example"}
          data-ask-demo="pause"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line-card text-ink-body hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      <div
        ref={stageRef}
        aria-hidden="true"
        data-ask-demo="stage"
        data-ask-demo-mode="motion"
        data-ask-demo-playing={playing ? "true" : "false"}
        data-ask-demo-t={String(Math.round(tRef.current))}
        data-ask-demo-step={`${frame.task}:${frame.step}`}
        className="p-3 sm:p-4"
      >
        <Stage frame={frame} />
      </div>
    </>
  );
}

/** The still: the frame the server renders and reduced motion keeps. */
function Still() {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line-row px-4 py-3 text-sm font-semibold text-ink-body" aria-hidden="true">
        <Sparkle />
        Ask C Stream
      </div>
      <div aria-hidden="true" data-ask-demo="stage" data-ask-demo-mode="static" className="p-3 sm:p-4">
        <Stage frame={finalFrame()} />
      </div>
    </>
  );
}

export function AskDemo({ className = "" }: { className?: string }) {
  // "static" is what the server renders, so the first client render
  // matches it and hydration is clean. The switch to motion happens in
  // an effect, after hydration, and only when nothing asked for less.
  const [mode, setMode] = useState<"static" | "motion">("static");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMode(query.matches ? "static" : "motion");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return (
    <figure
      data-ask-demo="figure"
      className={`w-full min-w-0 max-w-[34rem] overflow-hidden rounded-xl border border-line-card bg-surface text-left ${className}`}
    >
      {mode === "motion" ? <Player /> : <Still />}
      <p className="sr-only">{sceneDescription()}</p>
      {/* `ink-body`, not `ink-muted`: this is the sentence that keeps the
          scene honest, so it clears the text-contrast floor (the same rule
          panelChrome.tsx's caption follows). */}
      <figcaption className="border-t border-line-row px-4 py-2 text-[11px] leading-relaxed text-ink-body">
        {EXAMPLE_CAPTION}
      </figcaption>
    </figure>
  );
}
