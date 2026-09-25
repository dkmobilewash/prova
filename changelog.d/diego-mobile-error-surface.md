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
