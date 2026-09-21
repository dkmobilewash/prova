### The phone is a native iOS app now, not a dashboard squeezed onto a phone (Diego)
`diego/apple-redesign` — the Apple-HIG redesign of apps/mobile, no issue

The field app was consistent, flat and dark — every item on every
screen the same hairline card, the time screen stacking five notices
before the clock, three competing offline languages, and Home described
by its own comment as "a menu with a nicer name". Diego's brief: Apple
made a professional contractor management app.

**Two palettes over one vocabulary.** Light is the app's own HIG-derived
set (systemGroupedBackground, label/secondaryLabel); dark is the web's,
unchanged. `usePalette()` follows the system appearance with no
provider. New tokens: spacing, radius, and one shadow — used by the
floating capture button alone, because that 56pt circle over scrolling
content is the one surface that earns elevation. Yellow stays a FILL
that always carries the dark label; `link` is the only amber allowed as
text. `theme-contrast.test.ts` now iterates both palettes
(link-on-canvas holds 7:1 on dark, 4.5:1 on light — a light amber that
clears 7:1 stops reading as a link), and `theme-parity.test.ts` fails
the build if the vocabularies drift.

**Three tabs and one button.** Home · Jobs · More, with Create and
Camera collapsed into a floating capture sheet — Photo first, still two
taps from anywhere (`?open=camera`), gated by MANAGE_FIELD exactly as
the old tabs were. Home is a daily command centre: a greeting and the
phone's calendar date, the day's claims as tone-glyph rows (the same
sentences `lib/today.ts` derives — untouched), the job itself as one
quiet card, and today's photos as a strip.

**One furniture rule for the nine sections.** Job-context chip, one
SyncStatus group where the stacked banners used to be (every pinned
sentence preserved verbatim, including the punch list's own "changes
weren't saved / Dismiss" wording), the create action in a footer bar.
Time's entries became grouped rows split Today / Earlier with two facts
per meta line; photos became a two-up tile grid; punch items toggle by
tapping anywhere on the row; materials and safety pick dates on the
calendar (a promised-for date may be a future day); drawings' text
links became 44pt targets; sign-in — the last unthemed screen — wears
the system. Pressed states are a spring scale or the HIG cell fill,
never an opacity wash; the only animation added is the skeleton pulse.

**The guardrails.** `design-tokens.test.ts` fails the build on any bare
`colors` import (the migration shim is gone — nothing may pin itself to
one palette), any hardcoded radius, or any gap off the 4-pt scale.
`screen-capabilities.test.ts` now pins the capture gate where it lives
and pins the old tab files' absence. New screen tests cover the capture
sheet's routes and More's queue count. All pre-existing lib and screen
suites stay green, and every pinned string stayed letter-for-letter —
the only copy changes were the ones that named surfaces that no longer
exist.

**The check:** typecheck plus both vitest suites green, and Diego's
13-step phone click-list (light and dark, both appearances) — the real
gate, since the tests are text-only by design.
