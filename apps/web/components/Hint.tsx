"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * One sentence saying what a control DOES, on hover and on keyboard focus.
 *
 * WHY THIS EXISTS. The labels in this app are trade-literate and their
 * software consequence is not. "Release retainage", "Backcharge", "Close
 * out", "Send to QuickBooks" all name something a foreman knows; none of
 * them says whether clicking it records a fact here or puts a document in
 * front of the GC. A fifteen-person office cannot tell those apart from the
 * button, and somebody who is unsure does not click — an unclicked feature
 * is an unsold one. So the words go next to the control rather than in a
 * manual nobody opens.
 *
 * WHY IT IS NOT `title`. A `title` attribute is invisible to anyone tabbing,
 * unstyleable, and slow enough that people click before it appears. Six
 * files in this app used one before this component existed and none of them
 * reached a keyboard.
 *
 * ── THE GEOMETRY, WHICH IS THE HARD CONSTRAINT ──────────────────────────
 *
 * Most of what needs describing is a delete button in a row's action
 * cluster, and CLAUDE.md's rule 2 for those — "Cancel inherits the Delete
 * pixel" — rests on numbers measured in real Chromium against the actual
 * class strings. A wrapper that adds a box around a row action moves those
 * pixels and quietly invalidates the measurement, and no test in this repo
 * can catch it: happy-dom does no layout.
 *
 * So this adds NO BOX, by three deliberate choices:
 *
 *   1. The wrapper is `display: contents`. It generates no box at all, so
 *      the control stays a flex item of the caller's own cluster, with the
 *      caller's gap either side of it. This is the same device
 *      `ConfirmDelete`'s armed column already uses at >=640px, where it was
 *      measured byte-identical to the version without it.
 *   2. The tooltip is `position: fixed`, placed from the trigger's own
 *      `getBoundingClientRect()`. Out of flow, so it is not a flex item and
 *      cannot take a gap, and not clipped by the `overflow-hidden` on the
 *      nav rail or the `overflow-x-auto` on the metric bar (neither creates
 *      a containing block).
 *   3. While closed it carries the `hidden` attribute — `display: none`, no
 *      box, and not a flex item either. `aria-describedby` still resolves
 *      to it, which is the point: the description is readable by a screen
 *      reader in both states.
 *
 * Nothing is added to the trigger but one attribute. `aria-describedby` has
 * no layout.
 *
 * ── ON A PHONE ──────────────────────────────────────────────────────────
 *
 * There is no hover to have. Tapping the control does NOT leave a tooltip
 * standing over the row: `pointerdown` closes it and suppresses the reveal
 * that the click's own focus would otherwise cause, and `click` closes it
 * again. It can never intercept the tap — the wrapper has no box to be hit,
 * and the tooltip is `pointer-events-none`. The description stays available
 * to a screen reader through `aria-describedby`, which is how a phone reads
 * it. The honest summary: on touch these words are for assistive technology
 * and not for the eye, and the fix for touch is visible helper text, not a
 * popover.
 */

/** Half of the tooltip's max width (16rem), for keeping it on screen. */
const HALF_WIDTH = 128;
/** Air between the control and the tooltip. */
const GAP = 8;
/** Below this much room above it, the tooltip flips under the control. */
const HEADROOM = 72;

type Described = { "aria-describedby"?: string };

export function Hint({
  text,
  children,
}: {
  /** What HAPPENS, in the contractor's language, and whether anything
   *  leaves the building: "Records the release. Does not notify the GC."
   *  Never "Click to delete this item." */
  text: ReactNode;
  /** Exactly one control. It is cloned to carry `aria-describedby` and is
   *  otherwise untouched — no class, no wrapper, no change to its box. */
  children: ReactElement<Described>;
}) {
  const id = useId();
  const holder = useRef<HTMLSpanElement>(null);
  /* A click focuses its own button. Without this, every click would leave
     the tooltip standing over the row that just changed. */
  const fromPointer = useRef(false);
  const [at, setAt] = useState<{ left: number; top: number; below: boolean } | null>(null);

  function show() {
    /* The wrapper has no box, so the trigger's own rect is the only thing
       worth measuring — `getBoundingClientRect` on a display:contents
       element is not something to rely on. */
    const control = holder.current?.firstElementChild as HTMLElement | null;
    if (!control) return;
    const rect = control.getBoundingClientRect();
    const room = typeof window === "undefined" ? 0 : window.innerWidth;
    const centre = rect.left + rect.width / 2;
    const below = rect.top < HEADROOM;
    setAt({
      // Clamped so a control at either edge — a nav-rail icon, a
      // right-pinned row action — keeps its words on screen.
      left:
        room > HALF_WIDTH * 2 + 2 * GAP
          ? Math.min(Math.max(centre, HALF_WIDTH + GAP), room - HALF_WIDTH - GAP)
          : centre,
      top: below ? rect.bottom + GAP : rect.top - GAP,
      below,
    });
  }

  const hide = () => setAt(null);

  return (
    <span
      ref={holder}
      className="contents"
      onMouseOver={show}
      onMouseOut={(event: MouseEvent) => {
        // Moving between the control and something inside it is not leaving.
        if (holder.current?.contains(event.relatedTarget as Node | null)) return;
        hide();
      }}
      onFocus={() => {
        if (!fromPointer.current) show();
      }}
      onBlur={() => {
        fromPointer.current = false;
        hide();
      }}
      onPointerDown={() => {
        fromPointer.current = true;
        hide();
      }}
      onClick={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      {/* `isValidElement` IS LOAD-BEARING AND IS NOT DEFENSIVE PROGRAMMING.
          `children` is typed as an element, and at a call site inside a
          client component it always is one. It is NOT one when a SERVER
          component passes the child across the Flight boundary and React
          outlines it: `react-server-dom-webpack` defers any element it
          reaches after a row has already written 3200 bytes, replacing it
          with a `$L` reference that the client rehydrates as a lazy object
          — `{ $$typeof: REACT_LAZY_TYPE, _payload, _init }`, which has no
          `.props` at all. Reading `children.props[...]` on it threw
          `Cannot read properties of undefined (reading 'aria-describedby')`,
          and because the only such call site was `MetricBar` in the (app)
          layout, that took down EVERY authenticated page — permanently,
          through reloads, with no way back from the UI.

          It is a byte count, not a data problem: ~1 in 5 row sizes lands in
          a window where this fires, so an account could be dead at sign-up
          having created nothing. See changelog.d for the full derivation.

          Degrading here loses only the `aria-describedby` link on that one
          instance; the tooltip still renders and the page still works. A
          server-component caller should also be a client component so the
          child is never serialised — that is the better fix at the call
          site, and this is the guard that makes the class survivable. */}
      {isValidElement<Described>(children)
        ? cloneElement(children, {
            "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
          })
        : children}
      <span
        id={id}
        role="tooltip"
        hidden={at === null}
        style={at ? { left: at.left, top: at.top } : undefined}
        className={`pointer-events-none fixed z-50 w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-ink-muted bg-line-card px-2.5 py-1.5 text-xs leading-snug text-ink shadow-lg ${
          at?.below ? "" : "-translate-y-full"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
