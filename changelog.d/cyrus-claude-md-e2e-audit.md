### What actually changed, in plain English (Cyrus)
`cyrus/claude-md-e2e-audit`

**Docs only, and an audit under the 2026-09-07 exception.** No code, no
migration, no behaviour change — two false or incomplete claims in
`CLAUDE.md` dragged back to what the job logs say.

**One: CI has been browser-checking the signed-in app for two days while
this file said it could not.** The prime-directive section claimed half of
CI was RED until two repository secrets existed, that the `e2e` job died on
its first step naming `E2E_CLERK_PUBLISHABLE_KEY` and
`E2E_CLERK_SECRET_KEY`, and that *"NOTHING behind sign-in is checked in a
browser by CI, whatever colour the run is"*.

That was **true when it was written, for about thirteen hours.** #486's own
merge (2026-09-24 04:37:16Z) really did die 17 seconds in on exactly that
error — a 268-line job log. By 17:42Z the same day the job was running the
full suite on a 1,650-line log, and on 2026-09-26 it collects 63 specs,
signs in through a real Chromium and returns 63 verdicts. Both ends are in
the table now, with the SHAs.

The cost was not theoretical: three separate agents flagged the sentence in
one session, and each correctly declined to fix it inline because an audit
ships alone. A claim that a capability is MISSING is the direction that
stops people looking — the `InvoiceCounter` scar in the same file, arriving
from the other side.

**Two: `main` has now produced its first fully clean `e2e` run, and that is
a trap rather than good news.** Run 36220670340 at `3889b179` is green on
all four jobs with the journey passing a full 3m13s. The two commits after
it went red again. The #510 entry's *"two consecutive clean runs… `main` has
never produced one"* is therefore still exactly true and is left as
written — but a green `main` run now sits in the history between two red
ones, and anyone who finds it while checking whether #510 is fixed gets the
wrong answer. Recorded so they don't.

Worth more than the green run: `d6fa3a6f`'s list is the **fourth** disjoint
page list (seven entries — the job page itself twice, two of its tabs,
`/alerts`, `/drawings`, `/closeout`). Four lists now, and no page appears in
all four; `/dashboard` was the only page recurring across the first three,
and it is absent from this one. The list is the race's dice, not a location.
