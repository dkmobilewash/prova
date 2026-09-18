### A Clear history button on the Ask box (Cyrus)
`cyrus/ask-clear`

"Ask something else" already cleared the answer, the conversation the
assistant is sent, and the scrollback — but it only appears while an
answer is on screen. Come back to /ask and the old questions were listed
with no way to clear them. **Clear history** now sits above the scrollback
whenever it has rows, as the shared two-step `ConfirmDeleteButton` ("Clear
all" → "Clear them" / Cancel) — a hand-rolled confirm was the first draft
and `rowActionsCensus.test.ts` refused it, rightly. It calls
the same `startOver()` as "Ask something else", so the screen and the
model's memory can never disagree about what was cleared.

Clicked in the browser: Cancel keeps the rows; Clear them empties the list
and it stays empty after a reload. AskPanel has no render tests, so the
browser was the check.
