# DESIGN.md — the field app's design system

**All UI must follow this file.** It governs `apps/mobile` — the phone app.
It does **not** govern `apps/web`, which is dark-only and keeps its own
tokens in `apps/web/tailwind.config.ts` (see "What this does not govern").

Tokens live in `apps/mobile/lib/theme.ts`. That file is the executable
copy of this document; where the two disagree, the file is what renders
and this document is the bug.

## Where this came from

Extracted 2026-10-02 from `~/Documents/cstream-mobile-design-ui` — a v0
scaffold whose entire design is one 82-line `app/globals.css` plus a
106-line `app/page.tsx`. Three things about that source are worth
recording, because none of them is obvious from opening it:

- **There are no screenshots.** `public/` holds favicons and v0's stock
  `placeholder-*.png/jpg`. Every value below came from reading CSS, not
  from looking at a picture. Anything that needs the eye — optical
  spacing, how dense a list *feels* — was not verifiable from the source
  and is marked where it matters.
- **Two themes are stacked in that one file.** A blue/multicolour base
  (`#2e77b9` primary, violet/orange/green accent tiles), then a block
  commented `/* FieldLink monochrome theme: white surfaces, black type,
  yellow actions. */` appended after it. Later rules win at equal
  specificity, so **the monochrome theme is what renders** and the blue
  one is dead. This document extracts the monochrome theme.
- **That override also kills dark mode.** It is not inside a media query,
  so it beats the `@media (prefers-color-scheme: dark)` block above it.
  The reference therefore has no working dark theme. Ours does — see
  "Depth".

`components/ui/button.tsx` in that scaffold is **untouched default shadcn**
(`base-nova`, `bg-primary`/`text-primary-foreground`, `@base-ui/react`)
and `page.tsx` never imports it. It is scaffold, not design. Nothing in
this document comes from it, and nothing should.

## Colour

Three palettes over one vocabulary. Every token name exists in all three;
`theme-parity.test.ts` fails the build if they drift apart, and
`theme-contrast.test.ts` fails it if any text pair drops under its floor
(primary text 7:1, everything else 4.5:1 — AAA on primary because the
screen is used outdoors).

### light — from the reference

| token | value | notes |
| --- | --- | --- |
| `canvas` | `#ffffff` | the page. White, same as `surface` — see Depth |
| `surface` | `#ffffff` | cards, grouped rows |
| `rail` | `#ffffff` | header and tab bar, separated by a 1px top border |
| `railHover` | `#f1f1f1` | pressed row; the reference's search-field ground |
| `lineCard` | `#e5e5e5` | the 1px hairline that does all the separating |
| `lineRow` | `#e5e5e5` | row dividers — the reference draws these as 1px grid gaps over an `#e5e5e5` ground |
| `ink` | `#111111` | 18.88:1 on white |
| `inkLabel` | `#4d4d4d` | 8.45:1 — the reference's quick-action label |
| `inkBody` | `#6b6b6b` | 5.33:1 — the reference's secondary text |
| `inkMuted` | `#737373` | 4.74:1 — **substituted**, see Deviations |
| `brand` | `#facc15` | yellow FILL, never text. See Deviations |
| `brandInk` | `#171717` | the dark label a brand fill always carries — 11.71:1 |
| `link` | `#92400e` | 7.09:1 amber; the reference has no link colour |
| `linkHover` | `#78350f` | |

### dark, outdoor

Unchanged by this extraction. `dark` is the web's approved
"MainVision / Money Rail" set, copied exactly. `outdoor` exists for direct
sun: `#000000` ink on `#ffffff`, a `#6b6b6b` border heavy enough to
survive glare, and full-chroma status bars. Do not "make the palettes
consistent" — `outdoor` diverges on purpose and `card-depth.test.ts`
fails the build if it is elevated.

### The yellow rule, which survives every palette

`brand` is a **fill** and always carries the dark `brandInk` label. White
on this yellow is **1.53:1** — it shipped once on nine pages and is now a
build failure. As *text*, use `link`, never `brand`. At most one brand
fill per screen. The reference is disciplined about this too: every
yellow ground in it carries `#111111`.

## Type

System font (`ui-sans-serif, system-ui`), `antialiased`. No webfont —
the reference loads none, and neither do we.

The reference's hierarchy is adopted; its **sizes are not**. It runs
9–30px; this app floors at 13 with 17 for body, because the reader is
wearing gloves and moving. Same proportions, field-legible sizes:

| role | reference | here |
| --- | --- | --- |
| screen title | 30 / lh 1.0 / −.05em | 30, tight tracking |
| sheet title | 20 / −.03em | 20 |
| section heading | 18 / −.03em | 18 |
| row title | 13 | **17** (body floor) |
| secondary / meta | 11–12 | **13** (minimum) |
| overline | 10, w800, .16em, upper | **13**, w700, tracked, upper |
| tab label | 9 | **13** |

Labels run semibold (600); overlines and pills heavier. Tracking on the
big title is the reference's one real typographic move and it is worth
keeping: −.05em at 30pt, −.03em at 18–20pt, none below.

## Spacing

A 4-pt grid; `md` (16) is the screen gutter. The reference's own rhythm,
snapped to that grid:

| | reference | here |
| --- | --- | --- |
| screen gutter | 16 | `md` 16 |
| screen top | 24 | `xl` 24 |
| scroll bottom inset | 96 | `scrollBottom` 88 (clears tab bar + capture button) |
| section gap | 25 (18 compact) | `xxl` 32 / `lg` 20 |
| heading to content | 12 | `sm` 12 |
| card gap in a stack | 9 | `xs` 8 |
| card padding | 13 | `sm` 12 |
| control inset | 13 / 10 | `control` 10, `controlX` 14 |
| hairline divider | 1px gap | `one` 1 |

Four values sit off the grid on purpose and are named rather than left
bare: `control` (10), `controlX` (14), `badge` (3), `scrollBottom` (88).
A gap nobody can name is how two screens drift 1pt apart forever.

## Radius

By shape, not by number. Adopted from the reference, which is rounder
than what this app had:

| shape | reference | here (was) |
| --- | --- | --- |
| card | 15 | `card` **15** (12) |
| sheet tile / grouped list | 14 | `card` 15 |
| field / search | 11 | `field` **11** (10) |
| bottom sheet | 24 top | `sheet` **24** (20) |
| pill / status | 100 | `pill` 999 |
| small media | — | `small` 8 |
| day cell | — | `dayCell` 19 |

## Depth — the one structural rule

**A card is told apart by a shadow or by a border, never both**, and the
palette decides which. `cardSurface(palette)` is the only thing allowed
to make that choice; nine screens must not each decide.

| palette | treatment | why |
| --- | --- | --- |
| `light` | **flat** — 1px `#e5e5e5`, no shadow | the reference: white cards on a white page, separated by a hairline |
| `dark` | **lifted** — `shadow.card`, no border | a 1px hairline is nearly invisible on `#0f0f0f`; the surface step and shadow do the work |
| `outdoor` | **flat** — 1px `#6b6b6b`, no shadow | direct sun destroys a soft shadow; the border is the only cue that survives |

An outline *plus* a shadow reads as a box someone drew a shadow under.
`card-depth.test.ts` fails the build on that combination, on a palette
with no declared `depth`, and on `outdoor` being given elevation.

Elevation is used in exactly two places: `shadow.card` (opacity .06) for
the dark palette's cards, and `shadow.floating` (.18) under the floating
capture button — which must stay visibly the one thing above everything.

## Density and touch targets

**48pt minimum touch target**, not Apple's 44 and not the reference's 40.
Android's floor is 48dp and our users are in gloves; 44 is the smallest
target a bare fingertip hits reliably on a phone held still, which is not
the posture this app is used in. Primary actions get 56.
`touch-targets.test.ts` fails the build below 48.

| element | reference | here |
| --- | --- | --- |
| round icon button | 40 | **48** |
| quick-action tile | 48 | 48 |
| grouped row | ~40 | 48 |
| primary action | — | 56 |
| floating capture button | 52 | 56 |
| progress bar height | 5 | 5 |
| phone shell max width | 520 | n/a (native) |

## Buttons

- **Primary** — `brand` fill, `brandInk` label, `radius.field`, 56 tall,
  semibold. One per screen.
- **Secondary** — `surface` fill, 1px `lineCard`, `ink` label, 48 tall.
- **Ghost** — no fill, no border, `link` label, 48 tall.
- **Destructive** — never a plain fill. Two-step: the armed confirm
  inherits the delete's pixel, and on a phone that means a full-width
  column with **Cancel on top** (`ConfirmDelete` does this itself).
  Delete labels stay ≤12 characters.
- Pressed state is `railHover`, not an opacity change.
- **No default shadcn button styling, ever** — see the rule in CLAUDE.md.

## Inputs

- `surface` fill, 1px `lineCard`, `radius.field` (11), 48 tall.
- Inset `control` 10 vertical / `controlX` 14 horizontal — Apple's own
  fields sit at 14, which is why a chip beside one at 16 reads misaligned.
- Label above the field at 13 semibold `inkLabel`; the label-to-field gap
  is `six` (6).
- Placeholder is `inkMuted` — optional text only, never meaning.
- Focus is a `brand` 2px ring, never a colour change on the text.
- Errors render as text below the field in `tagRoseInk`, never as a red
  border alone.

## Lists and tables

The reference's grouped list is the pattern: a rounded container, rows
separated by **1px gaps over an `#e5e5e5` ground** rather than by
per-row borders. `GroupedList` implements this.

- Row height 48 minimum; 56 when the row has a title and a subtitle.
- Row inset `controlX` 14; chevron `inkMuted` at the trailing edge.
- Leading icon 20, optical centre aligned to the title's cap height.
- A count or status pill sits before the chevron, never after it.
- Dividers stop at the container's inner edge — no full-bleed hairlines.
- Every list has a real empty state with a way out, never a bare "None".

## Deliberate deviations from the reference

Recorded so nobody "fixes" them back. Each one is a decision, not a miss.

| # | Reference | Here | Why |
| --- | --- | --- | --- |
| 1 | `inkMuted` `#858585` | `#737373` | `#858585` is **3.69:1** on white and fails the 4.5:1 floor — at 9px, in the tab bar. `#737373` is 4.74:1, the nearest principled value with headroom |
| 2 | brand `#facc24` | `#facc15` | a 9-step difference in one channel, visually indistinguishable. `#facc15` is the founder-approved value and is already in the web config |
| 3 | type 9–13px | 13 floor, 17 body | gloves, and motion. The hierarchy is kept; only the sizes move |
| 4 | 40pt targets | 48 / 56 | Android's floor, and gloves |
| 5 | status pills all `#fff6c9` | semantic `tagRose`/`tagAmber`/`tagGreen` | the reference monochromes every pill, which erases overdue-vs-on-track. On a job list that distinction is the content |
| 6 | progress/bars all yellow | semantic `bar*` set | one progress bar can be brand-coloured; a multi-series chart cannot, or the encoding is gone |
| 7 | no dark mode | dark + outdoor kept | the reference's monochrome block overrides its own dark block. A field app in direct sun needs `outdoor`, which is the one palette glare does not destroy |
| 8 | `.handoff-card` flat, `.job-card` shadowed | one rule per palette | the reference mixes treatments within one theme. `cardSurface()` makes it one decision so the tenth screen cannot get it wrong |

## What this does not govern

`apps/web` — the web app is **dark-only** and keeps its tokens in
`apps/web/tailwind.config.ts`. That asymmetry is deliberate product
identity, recorded in `theme.ts`'s own header: a GC who sees a white
phone app and a dark web app is looking at two different products. Do not
make the two sides match.

`packages/ui` shares the web's tokens, not these.
