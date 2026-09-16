### The tray suggests what to do next, and yes/no/later already existed (Cyrus)
`cyrus/integration`

Cyrus: *"When they drop the documents I want it to also give them a
recommendation of tasks that it can do for them as well, then they can just
click yes or no or schedule it for later."*

**The yes/no/later machinery was already in the app**, which is why this
shipped as an alert source rather than a feature. `AlertAcknowledgement`
carries `snoozedUntil`, `snoozeAlert` exists, and the alert list already
renders dismiss and snooze — so "no" and "later" are free, correct, and
behave exactly the way they do for every other thing in this app that asks
for attention. "Yes" is the `href`, which `Alert` already documents as
"where to go and do something about it".

**And the key is why this belongs there rather than in a panel of its own.**
`alertKey` folds the FACT into the key, so a dismissal stops applying the
moment the situation changes. Dismiss "14 documents ready to file", file six
of them, and it comes back at 8 — which is exactly right, and is behaviour
nobody would have thought to write for a bespoke suggestions inbox. A second
place to look, with its own dismissal rules drifting from this one, was the
alternative.

Three suggestions, each a FACT with somewhere to go:

  - **files that need a person** — the ones the classifier could not read at
    all, called out separately from the backlog because they are the only
    rows that need thought rather than a click. Rolling them into "14
    waiting" is how the four that need attention get confirmed along with the
    ten that do not;
  - **the routine backlog**, counting only the rows the line above did not —
    `waiting - unreadable`. Two alerts that both count the same file read as
    twice the work;
  - **a job name on paperwork that matches no job here**, at three files or
    more. One file mentioning "Riverside" is a word in a filename; three are
    a job somebody has not created, or has created under another name. It
    says which it does not know, because guessing is the thing this screen
    exists to refuse.

Nothing here claims the app will do the work. This screen files nothing
without a person, and a suggestion that over-promises is worse than none —
the first one a contractor catches lying is the last one they read.

All three are STANDING with no date, no `daysUntil` and no amount. A tray is
a standing condition, and dressing it as OVERDUE would make it
indistinguishable in the list from a certified payroll filing that genuinely
is late.

`suggestions.test.ts` — 13 tests. The double-count, the singulars ("1
document is ready", not "1 documents"), the key changing with the number and
being stable without it, the raw count staying OUT of the key (issue #109's
shape: a key is readable in the RSC flight payload even where the permission
layer nulled the figure), and the capability matching the one `/intake`
itself requires — an alert is a summary of the thing it points at, so a
foreman who cannot open the tray is not told what is in it.

Mutation-proved, each shown to APPLY before its result was read: remove the
`- unreadable` and two tests fail; put the raw count in the key and one
fails; change the capability and one fails; drop the three-file floor and one
fails. A fifth mutation silently failed to apply and its green was discarded
rather than reported — the same trap this repo has been bitten by, caught
here by checking the substitution landed.

Lanes: this adds `DOCUMENT_INTAKE` to `AlertKind`, `ALERT_CAPABILITY` and
`ALERT_KIND_LABELS`, which is the shared alert engine Diego has worked in
(#109). Purely additive, no migration — `alertKey` is a string column and
`AlertKind` is TypeScript only. Flagged for him rather than assumed.
