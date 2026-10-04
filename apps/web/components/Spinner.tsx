/**
 * A spinner, because until now this app had none.
 *
 * Every in-flight state in the product was a WORD that stopped changing —
 * "Saving…", "Looking…", "Sending…", 133 of them across the app and not one
 * moving pixel. Cyrus named the cost while filming: a label that sits still
 * reads as a crash, not as work in progress. An ellipsis is a promise that
 * something is happening; nothing on screen keeps it.
 *
 * WHY IT IS AN SVG AND NOT A CSS BORDER TRICK. A bordered `div` spinner
 * inherits the page's colour tokens badly — it needs a transparent side,
 * which means picking a background, which means it is wrong on one of the
 * three palettes. An SVG stroke with `currentColor` is the colour of the text
 * beside it, always, in light, dark and outdoor, and it needs no token of its
 * own.
 *
 * IT KEEPS THE WORD. The spinner is `aria-hidden` and adds nothing for a
 * screen reader, because the label next to it already says what is happening —
 * and a screen reader announcing "loading loading" is worse than either. So
 * this is decoration in the strict sense: remove it and the meaning survives,
 * which is exactly why it can be hidden from assistive tech without loss.
 *
 * `motion-reduce:animate-none` because a spinner is the canonical thing
 * somebody with vestibular sensitivity has turned motion off for. With motion
 * reduced it becomes a static ring beside the word, which still reads as a
 * state and still does not lie.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      // `h-[1em] w-[1em]` so it scales with whatever text it sits in rather
      // than needing a size prop at every call site.
      className={`h-[1em] w-[1em] shrink-0 animate-spin motion-reduce:animate-none ${className}`}
    >
      {/* The track, at low opacity, and the arc over it. Two paths rather than
          one dashed circle: a dash array that looks right at 16px looks wrong
          at 24, and this scales cleanly. */}
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
