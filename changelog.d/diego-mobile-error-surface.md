### A queued write that never lands now says so, instead of closing the sheet (Diego)
`diego/mobile-error-surface`

Closes #483 and #485, and the first one turned out to be much worse than it
was filed as.

**What #483 said:** four screens declare an `error` state, render it, and
only ever call `setError(null)` — so a failure surfaces nothing.

**What was actually there.** `enqueue` ends in `AsyncStorage.setItem`, which
is uncaught and throws on a full disk or a store the OS has taken away.
Twelve call sites awaited it bare, and **nine of them cleared the form and
closed the sheet BEFORE the await**:

```tsx
setTopic("");
setShowTalkForm(false);
await enqueue({ type: "toolbox-talk:create", … });   // throws
```

So the sheet closed, the typed words were gone, nothing reached the queue,
and nothing was said. Not a missing error message — a **silent loss wearing
the shape of a save**, on the screens that record a safety incident and a T&M
ticket a GC has just signed.

The four screens in the issue were only the ones that happened to have an
unused `error` slot, which is what made them visible. `handover.tsx` and
`time/[jobId].tsx` had **no error slot at all** and the same bug. The
handover one is somebody's pay, entered on a phone that is not theirs.

**The fix is an ordering change, not a message.** `lib/save-queued.ts`
returns `{ ok }` instead of throwing — the same shape and the same reason as
the web's Server Actions (CLAUDE.md: production redacts a thrown message, so
a refusal that reads perfectly in dev reaches a real person as a dead
button). Every caller now queues FIRST and clears only on success:

```tsx
const saved = await saveQueued(op);
if (!saved.ok) return setError(saved.error);
…clear the form only now…
```

**And what the screen already promised gets taken back.** Six of these sites
push an optimistic row before the write — a punch item flipped to "ready", a
filed report, a photo tile, a time entry. On a failed write those were left
on screen claiming to be on their way. Each one is now rolled back, because a
row nothing will ever send is a worse lie than an error.

The message names THIS PHONE rather than the network. No signal is the normal
case and the queue already handles it; this only fires when the phone could
not write to its own storage, and "check your connection" would send somebody
outside to fix the wrong thing. The native error text is deliberately not
shown — it means nothing to somebody holding a phone, and the one useful
instruction does not depend on which error it was.

**Two guards, both mutation-tested, and the second is #485.**

`lib/queued-writes.test.ts` fails the build on a bare `enqueue` outside the
queue and its helper, and on **an error state a screen declares and never
renders** — which is #483 stated as a rule rather than a list of four files.
It matches on the state NAME rather than the literal `error`, because the two
screens that needed a new slot called theirs `saveError`; a check keyed to
one spelling would have passed over both. I know because I reintroduced the
exact bug while fixing it: `time/[jobId].tsx` got a `saveError` and, for one
commit, no line that drew it. The guard caught me.

| mutation | result |
| --- | --- |
| one screen back to a bare `enqueue` | RED, names the file |
| delete the line that renders `saveError` | RED, names the file and the state |

`lib/offline-notes.test.ts` is the guard `lib/empty-state.ts` has **cited
since it was written and which did not exist** (#485). That header says
*"`offline-notes.test.ts` fails the build on a cached list screen that writes
its own"* — true of an intention, false of the repository. It now fails on a
cached screen that types its own empty state instead of asking `emptyFor`,
which is what keeps "there is nothing here" from being said about data the
phone never loaded. That exact sentence was reported from site on 2026-09-20:
"Nothing outstanding on this job." read as a clean punch list to a foreman
standing in front of a wall that was not.

| mutation | result |
| --- | --- |
| a cached screen writes its own empty state | RED, names the screen |
| `emptyFor` stops distinguishing the two cases | RED, two cases |

**Worth saying plainly:** this is the second phantom guard found in
`apps/mobile` in two days. `lib/i18n.ts` cited `strings-census.test.ts`
twice; the day it was finally written it found twelve dead keys, two
half-translated screens and five shared components sitting in English. A
citation is not a check, and in this directory it has twice been read as one.

mobile: 208 + 65 tests, typecheck and lint clean.

---

**Caught up to `main` after #489 and #493, and two things fell out of the
merge that no conflict marker showed.** Git merged every hunk cleanly and the
whole mobile suite stayed green; `tsc` is what found the first one.

1. **`emptyFor` takes KEYS now, not sentences.** #489 changed its signature
   the same week `offline-notes.test.ts` was written against the old one, so
   `emptyFor(null, "the photos", { title: "No photos yet" })` merged clean and
   did not compile. Neither vitest config runs `tsc`, so 311 green tests said
   nothing about it. The unit cases read their expected sentences out of
   `EN` now rather than restating them, which also stops a reworded English
   string failing that file for the wrong reason.

2. **The failure message goes through the dictionary.** Every screen that
   draws it is in #489's `TRANSLATED` set, so an English literal here would
   have put one English sentence on an otherwise Spanish screen — the exact
   "half a translated screen is worse than none" case that census exists for.
   `save-queued.ts` holds the KEY (`save.failed`) and calls `t` at the point
   of failure, the way `lib/empty-state.ts` already does; it is not a hook and
   must not become one.

   **`strings-census.test.ts` cannot see this string, and that is worth
   recording rather than assuming.** Its literal detector reads text elements
   and text props; this is a bare value in `lib/`, so a hard-coded English
   sentence there passes all 28 of its cases. Verified by mutation, not
   argued. `queued-writes.test.ts` asserts the SPANISH instead — asserting the
   English would not help, since a literal identical to the dictionary entry
   satisfies it.

| mutation | applied? | result |
| --- | --- | --- |
| `saveFailedMessage()` returns an English literal | yes, diff shown | `strings-census` **green, 28 passed** |
| same mutation | yes | `queued-writes` **RED**, names the Spanish it expected |

---

**The ordering was applied at ten call sites and missed at four, and this
finishes it.** The four were found by loading the screens in a real browser —
nothing in this directory could see them, which is the second half of this
entry.

| where | what a failed write cost |
| --- | --- |
| `time` `closeInterval` | **the whole shift.** It returned `true` unconditionally, so `onClockOut` went on to `clearSession()` and erased `clockStartedAt`. Measured on a 4h 0m clock: queue empty, session gone, screen reading "Not on the clock" beside a line telling you to write it down — with nothing left to write down. |
| `time` `submit` | the crew's rows, the note and the date, and the sheet |
| `reports` `submitReport` | the daily field report's text; it threw away the `{ ok }` `create` returns for exactly this |
| `reports` `submitDelay` | the delay's eleven fields — under a comment claiming it did not clear them |

`saveEntry` returns its result now instead of `void`, which is what lets both
of its callers see a failure at all. `closeInterval` keeps the clock RUNNING
on a failed write, the same way it already refused the zero-hours case.
`submit` queues first and, if a row fails, keeps that row and every row after
it while dropping the ones already on the queue — offering those again is how
one crew member gets paid twice.

**AND THE ONE UNDERNEATH IT, WHICH WAS NEVER ABOUT ORDERING.** `saveEntry`
called `setSaveError(null)` on success, inside a loop that runs once per crew
member. So crew member 1 failing and crew member 2 succeeding **wiped the
message**: one worker's hours missing, one op on the queue, nothing on screen
and the sheet already closed. Driven in a real browser with two crew members
and the first write failing, before and after:

| | queue writes attempted | ops queued | error on screen | sheet |
| --- | --- | --- | --- | --- |
| before | 2 | **1** | **no** | closed |
| after | 1 | 0 | yes | open |

`saveEntry` no longer clears; its callers clear once, before they start.

**Two rollbacks were wrong, and both were wrong in the same direction —
they restored a VALUE and not the STATE.** The punch toggle wrote the old
status back into `local`, leaving the KEY there, and `queued` is
`local[item.id] !== undefined` — so the row went on reading "Open · Syncing…"
for a write that never happened, next to the line saying nothing was sent.
It restores the previous ENTRY now, including its absence; deleting the key
unconditionally would have been the other half of the same mistake, hiding a
tap that really was still in flight. And `useFieldReports`' `update` read
`before` from a closure-captured `reports` AFTER an await, and skipped the
rollback entirely when the row was not in that stale snapshot — leaving an
error on screen with the edit still under it, looking saved. It captures the
row inside the optimistic updater now, which sees the current array by
definition.

## The guard that would have caught all of it

`lib/write-ordering.test.ts`. Neither existing guard checked ORDERING, which
is the whole point of this PR: restoring the original bug at a fixed site
left all 311 mobile tests green. This one takes every function that awaits a
queued write and fails the build if anything that clears what a person typed,
or closes the sheet they typed it into, runs before that await. It derives
which calls ARE queued writes — `saveQueued`, local wrappers returning
`SaveResult`, and the two writers `useFieldReports` declares — rather than
being handed a list.

Same three house rules as every deriving check here, each mutation-proved:

| mutation | applied? | result |
| --- | --- | --- |
| `time` `submit` back to the old order | yes, diff shown | RED, names the file, the function and all four clears |
| `reports` `submitReport` back to the old order | yes | RED, names it |
| a clear added to `safety` `submitTalk`, a correct site | yes | RED, names it |
| the same, hidden behind a comment quoting `await saveQueued(` | yes | **RED** — comments are stripped first |
| a clear-before-write in a new `hooks/` directory | yes | **RED** — the roots are derived from the filesystem |
| the write-call derivation renamed so it matches nothing | yes | **RED** — "the pattern has stopped matching", 3 against a floor of 10 |

**And the two holes in the existing guards, closed with the mutations that
found them.** Both were live, both proved before and after:

| | before | after |
| --- | --- | --- |
| delete the line drawing `saveError`, leave a JSX comment `{/* rendered above as {saveError} */}` | **green** | **RED** |
| a screen types its own empty state under a comment `// TODO: route this through emptyFor(…)` | **green** | **RED** |
| a bare `enqueue` in `apps/mobile/hooks/` | **green** | **RED** |

The first two are #185's shape — a comment quoting the pattern satisfying it
— found inside two guards written after reading about it, which is now three
times in this repository. Both files strip comments before matching. The
third is the theme-contrast scar: `queued-writes.test.ts` walked three
hardcoded directory names, and nothing is ever missing from a directory you
do not walk. Its roots are derived now. `offline-notes.test.ts` keeps `app/`
on purpose and says why — expo-router defines a route BY being a file there,
so that root is the definition of the set rather than a guess at it.

mobile: 252 + 65 tests, typecheck and lint clean.
