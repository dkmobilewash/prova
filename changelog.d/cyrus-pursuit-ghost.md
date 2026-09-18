### A saved pursuit no longer shows twice, and a stage change or delete moves on the click (Cyrus)
`cyrus/pursuit-ghost`

**Found by clicking #316, not by its tests.** Driving /pipeline in the
browser after #316 merged: add a pursuit, and once the refreshed list
arrived there were TWO rows — the real one, and a "saving…" copy that never
left until a reload. The console said why: `Encountered two children with
the same key … saving-1`. After a successful save the create was held (so
it survives until the refreshed list lands) while `useOptimistic` was still
applying the in-flight copy on top — the same row twice, one React key, and
React's reconciliation left a ghost. #316's 29 tests were green: none of
them looked at the list between "held" and "transition ended".

A create whose row is already shown now replaces it instead of being
pushed again (`applyPursuitChanges`). Test first: it failed with
`['a', 'b', 'saving-1', 'saving-1']`.

**And #316 said stage changes and deletes show at once; they did not.**
Only a create was applied while its action was in flight. Setting a
pursuit to Dropped left it in the open list for seconds, until the answer
came back and was held. Every row change now goes through `useOptimistic`
too. A refusal for a row that had already moved to the other list, or left
the screen, is now said above the list — the row's own error line may no
longer exist to say it.

Checked in the browser on Cyrus's dev database: one row after a create, no
console errors; Dropped moves the row on the click and it stays moved; a
refused create keeps what was typed. The two new in-flight tests went red
against #316's component; the refused-move test went red with the message
removed. One test written for edits was dropped instead of kept: the edit
form stays open while it saves, so it could not fail either way.
