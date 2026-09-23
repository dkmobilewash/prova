import type { ReactNode } from "react";

/**
 * THE PAGE'S HORIZONTAL MEASURE, DECLARED AS AN INTENT RATHER THAN A NUMBER.
 *
 * Measured in Chrome on the deployed app, 2026-09-21, at a content area of
 * **1272 x 632** — the port inside the rail and the metric bar. `/settings`
 * poured a single 768px column down the middle of it, left **504px of empty
 * side space** (40% of the screen), and ran to **5.69 screens** of scrolling.
 *
 * A SCREENS-TO-SCROLL FIGURE IS PAGE HEIGHT DIVIDED BY VIEWPORT HEIGHT, SO IT
 * MEANS NOTHING WITHOUT THE HEIGHT IT WAS TAKEN AT. An earlier pass reported
 * this same page as "4.7 screens" with no viewport stated; it was taken in a
 * shorter port and neither figure can be reproduced from the other. Every
 * such number in this file carries its port for that reason.
 *
 * The width itself was nobody's decision. Across the 73 route files under
 * `app/` (`page.tsx` and `layout.tsx`), **55 centred and capped their own
 * column**; restricted to the 59 `app/(app)` pages, **49 of them did, making
 * 65 separate width decisions between them** — some pages make more than one.
 * They used nine different cap tokens: `max-w-2xl` (672px) through
 * `max-w-6xl`, plus `max-w-md`, `max-w-xl`, `max-w-none` and `max-w-[5in]`.
 * Each was defensible on its own page; 60% of the screen was the sum.
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
 *   reading -> `max-w-3xl`, 768px. The app's own most-used cap — 28 of the
 *              72 container decisions, ahead of `max-w-4xl` at 21 and
 *              `max-w-2xl` at 12. Measured on `/settings` in Chrome, the
 *              14px body type runs **101 characters per line** at this width
 *              and **172** at the full 1272. Past roughly 90 the eye starts
 *              losing the head of the next line, so 768 is already a ceiling
 *              rather than a target, and the case for widening a form page
 *              is not close.
 *   working -> `max-w-7xl`, 1280px. Above the 1272px content area a 16"
 *              laptop gives, so in practice it means "all of it", while
 *              still capping the line on a 27" display instead of running
 *              unbounded.
 *   aside   -> `20rem`, 320px — the value Tailwind's spacing scale calls
 *              `w-80`, written here inside the grid template rather than as
 *              that class. Measured in Chrome at a 1272px content area, the
 *              pair resolves to 320px + 872px, so the main column keeps a
 *              list's worth of room rather than a squeezed remainder.
 *   gutters -> `px-6 py-8`, the combination 47 of the 72 containers already
 *              wrote by hand — a plurality large enough that the shell is
 *              adopting the app's habit rather than imposing one. 24px of
 *              side gutter at 375px, measured: nothing touches the bezel and
 *              nothing overflows.
 *
 * THE SHELL IS ITSELF OUTSIDE THE CENSUS THAT ENFORCES IT. `mx-auto
 * ${MEASURE[width]}` below is the exact class string
 * `apps/web/lib/pageWidthCensus.test.ts` fails route files for, and it is
 * legal here because this file is not a route file — the census walks
 * `apps/web/app`. That is the correct boundary and also a familiar one:
 * `theme-contrast.test.ts` scanned `apps/web` for a month while the single
 * offending file sat in `packages/ui`, unseen because it was outside the
 * walk. Nothing here is wrong today. It is worth knowing that a width
 * mistake made IN THIS FILE is the one the guard cannot see, which is why
 * the values above are argued from measurements rather than taste.
 *
 * `packages/ui` is also named in neither WORK-SPLIT.md nor CLAUDE.md's list
 * of shared files, yet nine pages import from it. Treat it as shared and
 * edit it surgically.
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

/**
 * A BODY INSIDE A SHELL THAT ANOTHER FILE ALREADY OPENED.
 *
 * The job pages are the case: `jobs/[id]/(tabs)/layout.tsx` owns the page
 * container (the header and the tab rail, at `working`), and each tab is the
 * `children` of that layout. A tab cannot render a second `PageShell` — it
 * would add a second set of gutters — and before this existed it could not
 * choose a width at all, because the layout capped every tab at 768px.
 *
 * So a tab whose body is a form or a short document narrows ITSELF with
 * `<PageColumn width="reading">`, and a tab that is a list or a table
 * renders straight into the layout's `working` width. Same two intents as
 * `PageShell`, from the same `MEASURE`, so a "reading" tab is exactly as
 * wide as a "reading" page.
 *
 * Left-aligned rather than centred: it sits under the header and the tab
 * rail, whose left edge it shares, so the eye does not have to find where
 * the body starts. No gutters, because the layout's shell already has them.
 * `print:max-w-none` keeps a printed tab at the paper's width, which is what
 * the layout's old `print:max-w-none` did for every tab.
 */
export function PageColumn({
  width,
  children,
}: {
  width: "reading" | "working";
  children: ReactNode;
}) {
  return <div className={`${MEASURE[width]} print:max-w-none`}>{children}</div>;
}
