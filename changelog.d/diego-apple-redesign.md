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

**The handover screen joins the pass.** Once #405 merged, the redesign
rebased onto it and restyled the crew-handover screen into the same
system — safe-area header with the person's name at the large-title size,
the hours entry and the saved list as groups, the keypad glyph on the
PIN sheet — with every one of its strings frozen letter-for-letter (its
own test pins them, plus the absence of Jobs/Margin/Backlog/Invoice),
and its rails untouched: no header, no swipe-back, the on-disk flag that
survives a force-quit.

**The rebase also surfaced a launch crash that #405 had shipped.** The
drain timer's move to the root layout put `useQueueDrain()` — which reads
the session token through `useAuth` — in RootLayout itself, ABOVE the
ClerkProvider it depends on. Every launch red-screened with "useAuth can
only be used within the ClerkProvider component" before anything drew,
and no typecheck can see it: the dependency is a runtime context, not a
type. The call now lives in a `DrainTimer` component rendered beside the
handover gate — inside the provider, outside the gate, because a crew
member's hours must keep draining while the tabs are unmounted — and the
rails test pins all three of those properties out of the source.

**And a phone found what no test could: every empty-state description was
clipped to its top pixel.** `typography.leading` holds RATIOS (1.35);
React Native's `lineHeight` takes POINTS. `lineHeight:
typography.leading.normal` therefore drew a 1.35-point line, so the text
under "No reports yet", "No photos yet", "Nothing on order", "Nobody is
scheduled on this job." and the outbox's own empty line rendered as a
smear of glyph-tops that reads as blank space rather than as a bug. It
type-checked, it linted, and 193 tests passed over it, because happy-dom
does no layout — a clipped line and a drawn one are the same DOM. It was
found by walking the click-list on a real phone through iPhone Mirroring.

One site was already on `main` (`EmptyState`); this branch had added three
more. All four now call `leadingFor(size)`, which multiplies the ratio
into points, and `design-tokens.test.ts` gains a fourth census: a ratio
reaching any `lineHeight` fails the build, and the parse must account for
every `lineHeight` the scanned files declare, so a pattern that matches
nothing fails loudly instead of passing everything. Both halves were
mutation-tested — restoring the ratio goes red, blinding the pattern goes
red on the count.

**The door stops being Google-only.** Sign-in offered one button —
Continue with Google — which quietly decided who could use the app: a
framer whose email the office never linked to a Google account had no way
in at all. The screen now leads with email and password, keeps Google
underneath, and carries a reset path (email a 6-digit code, set a new
password, sign in) because the person who has forgotten a password is
holding the phone, not sitting at a desk. Nothing was needed in the Clerk
dashboard: the production instance already allows `password`,
`email_code` and `reset_password_email_code` as first factors — read from
its own public config rather than assumed.

**It signs people IN and deliberately does not sign them UP.** Creating an
account here would make a company rather than join one: `requireCompanyContext`
gives an address it has never seen its own empty company, so a new crew
member would land in an app with no jobs and reasonably call it broken.
The screen says so instead — "The office adds you first" — and a test
fails if a Create-account control ever appears.

Two smaller decisions worth the words. The screen imports `useSignIn`
from `@clerk/expo/legacy`: the root export in 4.6 is Clerk's new resource
shape (`signIn.password()`, `signIn.finalize()`, errors returned rather
than thrown), and adopting that is a deliberate migration, not something
to do by autocomplete. And Clerk's own error text is mapped to this app's
voice for the two codes that decide what a person does next — an unknown
email sends them to the office, a wrong password sends them to the reset
— while password-rule errors pass Clerk's sentence through untouched,
since the minimum length lives in the dashboard and any copy repeating it
here would go stale the day it changes.

**And the build config that would have shipped an app pointed at
nothing.** Both `EXPO_PUBLIC_` values are baked in at BUILD time, and on
a laptop they come from `apps/mobile/.env` — which is gitignored, and
which Expo's own docs say is "not available for jobs that run on a remote
server, for example, EAS Build". `eas.json` supplied neither. The first
TestFlight build would therefore have installed, launched, and reported
"No connection" on every screen, because the address it falls back to
(`http://localhost:3000`) is the phone itself — the app blaming a
jobsite for a mistake made at build time.

Three parts. `eas.json` now gives every profile an EAS `environment` and
hardcodes the API URL only where the answer never changes (production =
`app.cstream.ai`). Preview is deliberately left out, because a preview
build must be TOLD which deployment it is testing and the convenient
default has testers writing real rows; development is left out because a
dev client takes its JS, and therefore its values, from Metro — and
because a hardcoded localhost would be wrong on a device, where
localhost is the device. That last point was already written down in
`.env.example` and was nearly lost: this change overwrote that file
before reading it, and the warning had to be restored from the diff. `lib/env.ts`
owns both reads and answers `configProblem()`, so a release build with
no server address says exactly that instead of impersonating bad signal
— rendered before ClerkProvider, since an empty publishable key throws
inside it and a crash cannot explain itself. And
`lib/eas-config.test.ts` derives the variable list from the app's own
source and fails the build unless every profile accounts for every one,
either with a literal or by being named — with a reason — as coming from
the EAS environment. Keys stay out of the repo; `.env.example` carries
the `eas env:create` lines instead.

Mutation-tested three ways: dropping the production URL, blinding the
capture pattern, and adding a new `EXPO_PUBLIC_` read to the app each
turn it red, the last naming all three profiles that would ship without it.
