## The suite stops depending on which Node you happen to run

**Five tests passed in CI and failed on a laptop, and the difference was
Node.** `sentDateDefault.test.ts` clears `window.localStorage` between
cases, because the form-draft hook restores a stored draft the moment a
form attaches. On Node 20 — what `ci.yml` pins — happy-dom supplies that
storage. On Node 26 it does not: Node now ships its own experimental
`localStorage`, and WITHOUT `--localstorage-file` that global is
`undefined` rather than absent. happy-dom passes the undefined straight
through, so `window.localStorage` is an own property whose value is
undefined — a shape no code guards for, and the five tests died on it.

The cost is not the five tests. It is that a suite which only passes on
the CI runner's Node is a suite nobody runs before pushing, which is
exactly when a red is cheap.

`vitest.setup.ts` now installs an in-memory Web Storage, and only where
the runtime provides none. Deliberately conditional: on Node 20 the real
happy-dom implementation is what the app meets in a browser, and a double
that quietly replaced it would turn every storage assertion into a
statement about the double. `test/memory-storage.test.ts` pins that rule
— it is the case that goes red when the guard is removed.

**And a census that reported a merge as a defect.** `numericInputCensus`
compares its own file walk against `git ls-files --cached`. During an
unresolved merge that command prints a conflicted path ONCE PER STAGE —
proved in a scratch repo: one file, three lines — so the lists stopped
matching and the census failed with "the walk and git disagree about
which files exist" while the code was fine. A red that is really "you are
mid-merge" is a red nobody believes on the day it is real. Both that
census and `viewerDayCensus` now dedupe, which is what
`errorBoundaryCoverage` already did. `actionErrorBoundaryCensus` is
untouched: duplicates can only inflate a lower bound there, and its files
land in a Map.

One thing this fix cannot prove by test: the dedupe itself needs a
conflicted index to exercise, so it is verified by the scratch-repo
experiment above rather than by a case in the suite.
