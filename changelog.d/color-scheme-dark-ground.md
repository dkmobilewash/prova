### The date picker's button was painted black on a black field, on 112 date fields (Cyrus)
`cyrus/seed-counters-zzbqtu`

`apps/web/app/globals.css` never declared `color-scheme`, so every control
the BROWSER paints — rather than our CSS — kept its light-mode appearance on
a page whose ground is `#0f0f0f`. One line fixes it. The reason it is worth a
changelog entry is what the measurement turned out to be.

**Measured in real Chromium, not reasoned about.** The calendar glyph on
`<input type="date">` is painted `#000000` on our `#0f0f0f` field:

| | the glyph | the field under it | ratio | the floor |
| --- | --- | --- | --- | --- |
| as shipped | `#000000`, 36px | `#0f0f0f` | **1.1:1** | 3:1 for non-text |
| with `color-scheme: dark` | `#ffffff`, 35px | `#0f0f0f` | 19.2:1 | 3:1 |

The pixel counts are the part that settles it: **36 and 35 — the same glyph,
painted in the opposite colour.** Not a control appearing, a control that was
rendering the whole time and could not be seen. 112 date inputs across the
app.

**Why no test here could have found it, and how it was found anyway.** The
screen suite renders in happy-dom, which does no layout and no painting;
`theme-contrast.test.ts` reads OUR colour pairs out of OUR class strings, and
this glyph lives in a shadow root nobody in this repo wrote. So it was
screenshotted in the local Chromium and the pixels sampled — `setContent`
only, no server and no sockets, which is what makes it runnable in an agent
container where loopback is refused.

**Both of the probe's own controls held, and they are the reason the number is
believable.** The positive control: `getComputedStyle(root).colorScheme` read
`normal` then `dark`, so the declaration was genuinely in effect. The negative
control: a plain `<input type="text">`, which our CSS paints entirely, came
back byte-identical in both arms — so the arms differ by the declaration and
not by something else. A first pass used `#0a0a0a`/`#262626` from memory
instead of the real `canvas` and `line-card` tokens; re-run against
`tailwind.config.ts`.

**What else moves, stated honestly rather than claimed as a win.** The file
input's "Choose File" chip stops being a near-white button on a dark page
(`#efefef` → `#6b6b6b`, still clearing the 3:1 non-text floor at 3.6:1), and
the checkbox/radio accent moves to the browser's dark-mode accent, which
lifts the radio's contrast against our canvas from 4.55:1 to 11.01:1. **Not
claimed: the scrollbar.** Headless Chromium reports a scrollbar width of 0 —
overlay scrollbars — so nothing here measured it. **Also not claimed:** the
`<select>` chevron and the number spinners did not move in this instrument,
but the instrument reports the two most common colours in a clip and a
few-pixel glyph is invisible to it. That is a limit, not a finding.

**UNCONDITIONAL, and that is a fact about this app rather than a shortcut.**
There is no `darkMode` in `tailwind.config.ts` and no `data-theme` anywhere;
the palette flipped to dark in full on 2026-09-11. The five printable
documents that DO sit on white paper — WH-347, DAS-140, DAS-142, the photo
report, the union remittance, the pay application — are white CARDS inside
the dark shell, not white pages, and **each has zero browser-painted
controls**, so nothing on them is reached by a declaration about controls.
That was checked before the declaration went in, not after.

**The guard is the differential.** `colorSchemeGround.test.ts` holds three
things: the declaration exists at `:root` and says `dark`; nothing declares a
second or opposite value; and **no browser-painted control sits on a light
ground**. That last one is the one that matters — put a date field on the
WH-347 and `color-scheme: dark` would paint a dark-mode control on paper going
to the state, so the test fails naming the file instead of the document going
out wrong.

**Mutation-tested seven ways, and two of the seven were found broken by the
mutations rather than confirmed by them.**

- **M5 was GREEN on the first run**, with the control pattern's `date` arm
  drifted so no date input matched. The size assertion compared "files with
  ANY browser-painted control" against "files with a date input" — different
  sets, the first much larger, so the inequality stayed comfortably true
  while 112 fields stopped being seen. **A size assertion has to be about the
  same SUBJECT as the thing it guards**, so it is now an equality between two
  independent reads of one question: which files hold a date input. M5 now
  reds naming all 59.
- **M6 failed as a COLLECTION error printing `no tests`**, because the scope
  assertions ran at module scope. Red, but red in the way CLAUDE.md refuses
  outright — a failure indistinguishable from never having run. The scan is
  memoised and called inside a test now, so a `content` glob pointing
  nowhere reds with a message.

The other five: the declaration deleted, the declaration present only inside
a comment (the #185 shape, and load-bearing here because the fix's own
comment block spells `color-scheme: dark` while explaining it), `dark` changed
to `light`, a date field put on the white WH-347 card, and a component
setting a scheme of its own. Control green before and after every restore —
file copies, never `git checkout --`.

One smaller thing worth keeping: the "declares no second value" check first
reported the correct declaration as an offender. `(?!dark\b)` after `\s*` lets
the engine backtrack onto the space and match ` dark`. Captured plainly and
filtered in JS now — a clever pattern that is wrong about its own subject is
worse than a dull one.

Verified by result rather than by the source: `:root{color-scheme:dark}` is in
the built stylesheet of a production build.
