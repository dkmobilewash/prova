### The phone speaks Spanish, and a census keeps it honest (Diego)
`diego/spanish`

Most hangers and tapers do not carry a company phone, and a great many of
them do not work in English. An app that only speaks English is one a foreman
translates out loud, line by line, while somebody stands there with a taping
knife — and "log your hours" is the one task the phone exists to hand over.

**The device's language comes first.** A phone set to Spanish opens in Spanish
with nothing to find and nothing to tap. The switch on the More tab is for the
other cases: a shared phone, or a foreman who reads English whose crew does
not. Scoped to the field screens on purpose — the office half is read by the
person who bought it, and half-translating a screen is worse than leaving it,
because a Spanish sentence beside an English one reads as a bug to the one
person who cannot report it.

**The branch was already written and it did not work.** Three things, and the
shape of them is the point rather than the fix:

- `loadLanguage()` was defined and never called, so a saved choice was never
  read back;
- `setLanguage()` had no caller anywhere — there was no way to choose a
  language at all;
- `strings-census.test.ts`, which `i18n.ts` cites TWICE as the thing keeping
  Spanish in step with English, did not exist. (`lib/empty-state.ts` cites a
  second phantom guard, `offline-notes.test.ts`. Also missing. Not fixed here.)

A cited check that does not exist is worse than no check, because everyone
downstream reads the citation and stops looking. That is this repo's
"written, documented, and never called" shape wearing a test's name.

**So the census exists now, and it asks five questions rather than one.** Key
parity; **placeholder parity**, which the type system cannot see at all — `ES`
is typed against `keyof typeof EN`, so a missing key fails the build, but a
translation that drops `{count}` type-checks perfectly and renders a claim
with the number missing; dead keys; scope; and English literals on a screen in
scope. It found things in four of the five: 12 orphaned keys, two screens that
were half-translated (Spanish empty state, English everything else), and 15
English strings on them.

**The dead-key check was vacuous when first written, and that is recorded here
because it is the exact trap this file's rules are about.** Its haystack
included `en.ts` itself — which contains the line `"outbox.tried.one": …` — so
every key matched its own definition and the check could never fail. It passed
clean on a tree with twelve provable orphans. The dictionaries are excluded
now and the exclusion is argued in the test rather than quietly filtered.

The literal detector asserts that it can still SEE the same way: it is pointed
at `sign-in.tsx`, which is deliberately untranslated, and required to find
something there. A detector that stops matching now fails loudly instead of
reporting a clean sweep over sixteen screens.

**And then it shipped the other half of that scar anyway, which is the part
worth keeping.** The detector walked `app/` and nothing else. So
`SyncStatus`, `JobContextChip`, `DateField`, `SignaturePad` and
`NotYourJobFunction` — the banner across the top of every field screen, the
chip under it, the date chips inside every sheet, and the words directly above
the pad a crew member signs — sat in **English on top of sixteen screens the
census was calling clean**. `CaptureSheet` and the ＋ button, the app's primary
action, were English too and nobody had noticed at all.

That is `theme-contrast.test.ts`'s failure exactly — *nothing is ever missing
from a directory you do not walk* — reproduced in a census written by someone
who had just read that entry. A size assertion cannot help: a file outside the
walk is not a small set, it is not in the set.

So the shared scope is DERIVED rather than listed. The census follows `@/`
imports out of every translated screen, transitively, and anything under
`components/` or `lib/` that a translated screen can reach is in scope, with
exclusions that must each carry a reason. A component added to a field screen
tomorrow is in scope the moment it is imported, with nobody remembering to
add it anywhere.

Proved by mutation, and the middle row is the world as it shipped:

| | SyncStatus | census scope | result |
| --- | --- | --- | --- |
| M1 | English restored | derived from imports | RED, names the file |
| M2 | English restored | old `app/`-only | **green — 17 passed** |
| M3 | translated | derived from imports | 27 passed |

**A real day-drift bug, found while translating and fixed here.** `todayKey()`
was `now.toISOString().slice(0, 10)` — the UTC day — while Home printed
`longDate(localToday())`, the phone's day. After ~18:00 Mountain those are
different dates, so Home read "Wednesday, September 23" over lines counted
against the 24th: "No photos today" under a date on which photos were taken.
`time/[jobId]` called it too, which is the screen where a wrong day is
somebody's hours filed against the wrong date.

This is the same bug `lib/local-today.ts` was written for on the schedule
screen on 2026-09-20, at a second site, and its header describes it exactly.
`todayKey` delegates to `localToday` now. Rows are still stored and rendered
at UTC midnight — that convention is untouched, and the module header saying
otherwise has been corrected. What changed is only "which of those days is
today", which is a question about where the person is standing.

The test for it FORCES `TZ=America/Denver` and asserts that it took, because
the case is vacuous in UTC — the two spellings agree there, CI runs there, and
a reverted `todayKey` would pass. Mutation-tested both ways: reverting the fix
turns two cases red, and running the same test in UTC fails on the vacuity
guard first, with "this whole describe is vacuous" rather than a green tick.

**Dates read in the right language too.** Home's `longDate` was built from
hardcoded `MONTHS`/`WEEKDAYS` arrays; it uses `Intl.DateTimeFormat` with
`timeZone: "UTC"` now, so `Monday, September 21` becomes `lunes, 21 de
septiembre` and the UTC construction that keeps the calendar day from
drifting is untouched. It falls back to the old English arrays inside a
try/catch, because a runtime without full ICU must degrade to an English date
rather than crash the screen the app opens on.

**Plurals are a branch, never a letter on the end.** English picks
"photo"/"photos" off a count; Spanish picks a different word AND agrees the
participle with it — *1 hora registrada*, *2 horas registradas* — so two
plurals in one sentence need four whole sentences, not two halves and a join.
`lib/today.ts` now returns a translation KEY and its variables instead of a
finished English sentence, which keeps it a pure function and makes its tests
assert the branch that was chosen rather than the wording that was used.

**Four keys were deleted rather than wired.** `settings.language.en` and
`.es` are gone on purpose: a language is named in its own language, the way
every OS does it, so "English" and "Español" are literals in the switch and
not keys — somebody who cannot read the current language must still be able to
find their own. `time.sheet.save` and `photos.pick` were simply dead.

**Known and deliberately not done, so nobody reads this as finished.** The
OSHA incident classification and outcome chips stay in English — they are API
enum values rendered by `.replace(/_/g, " ")`, and the same enum appears on
the chip and on the saved card, so translating one alone would show a foreman
"Solo primeros auxilios" when he picks it and "FIRST AID ONLY" a second later.
A Spanish-only foreman therefore still chooses OSHA recordability in English.
Doing it properly means a display map keyed off the enum and wording lifted
from OSHA's own Spanish 300/301 forms rather than invented — the arrays are
typed `string[]` and the queue op takes `classification: string`, so Spanish
text would reach the API AS the enum value with nothing to catch it.

Also flagged for a native speaker rather than silently shipped:
`safety.field.employee` reads "Nombre del trabajador", but *trabajador* is
"worker" and OSHA recordability turns on the person being your EMPLOYEE — a
sub's injured worker goes on the sub's log. OSHA's Spanish 301 says *nombre
del empleado*. The glossary at the top of `es.ts` exists for exactly this
kind of correction and a foreman changing it is a one-line edit.
