import type { ReactNode } from "react";

/**
 * THE PAGE'S HORIZONTAL MEASURE, DECLARED AS AN INTENT RATHER THAN A NUMBER.
 *
 * Measured on the deployed app at a 1272px content area, 2026-09-21:
 * `/jobs/<id>` and `/settings` both poured a single 768px column down the
 * middle and left **504px of empty side space** — 40% of the screen — while
 * `/settings` ran to 4.7 screens of scrolling. Across `app/(app)` there were
 * 59 `page.tsx` files, 63 per-page `max-w-*` caps, and only 10 pages using a
 * multi-column grid at any breakpoint. Every page had picked its own number
 * independently: 25 chose `max-w-3xl`, 18 chose `max-w-2xl` (672px — narrower
 * than a phone-sized column has any reason to be on a 27" monitor), 20 chose
 * `max-w-4xl`, and the rest chose one of three others.
 *
 * THE TRAP THIS EXISTS TO AVOID: widening everything makes it worse. A form
 * field stretched to 1272px is harder to read than one at 768 — line length
 * is exactly why those caps were added, and each one was individually
 * defensible. The goal is not "use the whole width", it is **"use the width
 * for a second thing"**. So this component does not offer a number. It offers
 * three answers to "what kind of page is this?", and owns the pixels itself:
 *
 *   `reading`  a form, a settings panel, a document. Line length is the
 *              constraint, so the measure stays comfortable and the page is
 *              deliberately NOT widened. Converting such a page changes no
 *              pixel — the point is that the page stops owning the number.
 *
 *   `working`  a list, a table, a register. More rows visible is the whole
 *              point, so it takes the width. This is where the 504px goes.
 *
 *   `split`    two columns: a thing, and the thing it feeds — an "add an
 *              item" form beside the list it adds to. Collapses to one
 *              column below `lg`, in document order.
 *
 * `split` is a separate variant rather than a second prop on `working` on
 * purpose: `aside` is required when you ask for it and rejected when you do
 * not, so "two columns" is a decision the type checker makes you finish. The
 * awkward thing to express here is the wrong thing — there is no way to ask
 * for 1272px of single column.
 *
 * VALUES ARE TAILWIND SCALE POSITIONS, NOT NEW TOKENS:
 *   reading -> `max-w-3xl`, 768px. The app's own most-used cap (25 of 63),
 *              and ~100 characters at the 14px body size these pages are set
 *              in — already at the top of a comfortable measure, so it is a
 *              ceiling rather than a target.
 *   working -> `max-w-7xl`, 1280px. Above the 1272px content area a 16"
 *              laptop gives, so in practice it means "all of it", while
 *              still capping the line on a 27" display instead of running
 *              unbounded.
 *   aside   -> `20rem`, 320px — `w-80` on the spacing scale. At `working`
 *              width that leaves the main column ~872px, which is still a
 *              list's worth of room rather than a squeezed remainder.
 *   gutters -> `px-6 py-8`, which is what 51 of the 59 pages already wrote by
 *              hand. 24px of side gutter at 375px, so nothing touches the
 *              bezel and nothing overflows.
 *
 * The breakpoint is `lg` (1024px), matching `SidePanel`, which is the other
 * component in this app that turns a second column on and off and returns at
 * `lg:flex`. Two side-by-side columns and a visible rail cannot disagree
 * about when there is room for them.
 *
 * No transition and no animation anywhere in here, so there is nothing for
 * `prefers-reduced-motion` to have an opinion about: the layout changes at a
 * breakpoint, which is a reflow rather than a movement.
 *
 * Phase 1 of four. Phases 2-4 (the remaining pages, density, phone) are
 * deliberately not attempted here — this exists to make them cheap.
 */
export type PageWidth = "reading" | "working" | "split";

/** `max-w-3xl` and `max-w-7xl` are written as whole literals rather than
 * assembled from parts, because Tailwind scans source text for class names:
 * a name built by interpolation is not in the stylesheet at build time and
 * the rule silently does not exist. */
const MEASURE: Record<PageWidth, string> = {
  reading: "max-w-3xl",
  working: "max-w-7xl",
  split: "max-w-7xl",
};

type Common = {
  children: ReactNode;
  /** Extra classes for the outer container. Deliberately NOT a route to a
   * different width — `pageWidthCensus.test.ts` fails the build on a
   * `max-w-*` reaching a page container from anywhere, including here. */
  className?: string;
};

type Props =
  | (Common & {
      width: "reading" | "working";
      aside?: never;
      asideLabel?: never;
    })
  | (Common & {
      width: "split";
      /** The narrower, feeding column: the form, the filters, the summary
       * the main column is a consequence of. Rendered FIRST in the DOM and
       * on the LEFT at `lg`, so the reading order is the same in both
       * directions — below `lg` it stacks above the main column, which is
       * the order these pages already had when the form sat above the list.
       * Nothing is reordered by CSS, so a screen reader and a keyboard walk
       * the page the way it looks. */
      aside: ReactNode;
      /** Names the aside region for a screen reader, e.g. "Add an item".
       * Two landmarks on one page need telling apart. */
      asideLabel?: string;
      /** The page's own title and standfirst, spanning BOTH columns.
       *
       * Without it a split page's `<h1>` lands at the top of the main column
       * — which is to the RIGHT of the aside on a wide screen, so the page
       * appears to be titled halfway across itself. A heading belongs to the
       * page, not to one of its columns. Only `split` takes this, because in
       * the other two the children already flow from the top of the only
       * column there is. */
      header?: ReactNode;
    });

export function PageShell({ width, children, className = "", ...rest }: Props) {
  const container = `mx-auto ${MEASURE[width]} px-6 py-8 ${className}`.trim();

  if (width !== "split") {
    return <div className={container}>{children}</div>;
  }

  const { aside, asideLabel, header } = rest as {
    aside: ReactNode;
    asideLabel?: string;
    header?: ReactNode;
  };

  return (
    <div className={container}>
      {header}
      {/* `minmax(0,1fr)` on the main column, and `min-w-0` on both, so a wide
          child — a long unbroken job name, a table — shrinks the column
          instead of pushing the grid past the viewport. Without it a grid
          track's default `auto` minimum is its content, which is how a
          two-column layout produces horizontal page scroll. */}
      <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <aside className="min-w-0" aria-label={asideLabel}>
          {aside}
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
