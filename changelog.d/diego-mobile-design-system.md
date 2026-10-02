### A design system with a document, and the light palette changes sides (Diego)
`diego/mobile-design-system`

**Phone only. No schema, no migration, no web files, no logic.** The web
app is untouched and stays dark.

**WHAT CAME IN.** `DESIGN.md` at the repo root, extracted from
`cstream-mobile-design-ui` — colour, type, spacing, radius, depth,
density, buttons, inputs, list density — plus a CLAUDE.md rule making it
the authority ("All UI must follow DESIGN.md. Don't use default shadcn
styling"). `apps/mobile/lib/theme.ts` is its executable copy and says so
in its own header.

**THREE THINGS ABOUT THE SOURCE, recorded because none is obvious from
opening it.** It ships **no screenshots** — `public/` is favicons and v0's
stock `placeholder-*` files, so every value here came from reading CSS,
not from looking. Its design is **two themes stacked in one 82-line
file**: a blue/multicolour base, then a `/* FieldLink monochrome theme */`
block appended after it, and later rules win — so the monochrome theme is
what renders and the blue one is dead. That override is **not** inside a
media query, so it also beats the `prefers-color-scheme: dark` block above
it: the reference has no working dark mode. And its
`components/ui/button.tsx` is **untouched default shadcn** that its own
`page.tsx` never imports — scaffold, not design, which is precisely why
the CLAUDE.md rule names shadcn.

**THE LIGHT PALETTE CHANGED SIDES, and #584 was not wrong.** #584
darkened the canvas to `#e5e7ee` so white cards would lift off it, on the
correct observation that with a ~4% step the outline was doing all the
separating. The reference removes the *premise* instead of the conclusion:
its canvas and surface are the **same white**, and a card is told apart by
a `#e5e5e5` hairline. With no canvas step there is nothing for a shadow to
fall on. So `light` is now `flat`, `dark` stays `lifted` (a hairline is
nearly invisible on `#0f0f0f`), and `outdoor` stays `flat` with its
glare-proof `#6b6b6b`. The old reasoning is kept in `card-depth.test.ts`'s
header rather than deleted — it was right about the canvas it described.

**WHAT THE REFERENCE DID NOT GET TO CHANGE.** Its type runs 9-13px on
40pt targets. Body stays **17**, nothing below **13**, targets stay
**48** — the parts that earn their keep in gloves. The hierarchy was
adopted (30/-.05em title, 18/-.03em section, tracked overline); the sizes
were not. Eight deviations total, each with its reason, in DESIGN.md's own
table so nobody "fixes" one back.

**ONE VALUE WAS SUBSTITUTED RATHER THAN COPIED.** The reference's muted
grey `#858585` is **3.69:1** on white and fails the 4.5:1 floor — at 9px,
in the tab bar. `#737373` (4.74:1) is the nearest principled value with
headroom. Every one of the 17 enforced pairs was computed before the file
was edited, not after.

**AND A REGRESSION THE TESTS COULD NOT HAVE SEEN.** Making `rail` white
made it identical to `surface`, and `app/job/[jobId].tsx` used
`colors.rail` as its activity-tile **pressed** state — so a pressed tile
would have shown no feedback whatsoever. Nothing in this repo can catch
that: it is two tokens being equal, which is legal, on a state no test
renders. Found by grepping every `rail`-as-background use after the change
and asking what it sat on. It is `railHover` now, which is what
`GroupedRow` and `JobContextChip` already used.

| mutation | card-depth |
| --- | --- |
| control, nothing changed | green |
| `light` flips back to `lifted` | **RED** |
| `outdoor`'s border softened to light's hairline | **RED** |

That second row is the one worth having. The two flat palettes are flat
for *different* reasons, and a "both flat, so share the value" tidy-up
would spend the only cue a crew in direct sun has. The new assertion
compares the two border weights rather than trusting a comment.

**Still unverified, and it needs a phone.** Nothing here was looked at on
a device. The tab bar separates by a 1px top border it already drew, so
white-on-white is fine there; `handover.tsx`'s header draws **no** border
and is now white on white, which matches the reference's own borderless
topbar but has not been seen. Suites: 37 files / 319 tests and 15 / 74,
typecheck clean.
