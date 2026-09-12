### Twenty-seven refusals that nobody has ever read (Cyrus)
`cyrus/visible-errors`

Production replaces the message of any error thrown from a Server Action
with React's own boilerplate paragraph. Four modules — `punchLists.ts`,
`equipment.ts`, `vendors.ts`, `rfis.ts` — refused by throwing, so every
sentence written in them for a user was invisible to that user. They return
`ActionResult` now, and the eight components behind them render it with
`role="alert"`.

`rfis.ts` was the worst of it and the reason the change is worth its size.
Eleven guards, each a sentence written for somebody who may end up quoting
this log in a dispute — "Send this RFI before recording an answer", "The
answer can't have come back before the RFI was sent" — and all eleven
thrown. What the RFI page actually rendered was its own local fallback
string ("Could not mark it sent"), because `err.message` in production is
not the app's message at all.

**CLAUDE.md's redaction claim re-verified, and this time from source rather
than from a build.** It was established on 2026-08-27 against a real
production build, and everything here rests on it, so it was worth
confirming against the 15.5.23 actually on disk (`package.json` says
`^15.1.3`, which is not what is installed). It is structural, not a
configuration: in `react-server-dom-webpack-server.node.production.js` the
error serialiser is `emitErrorChunk(request, id, digest)` — **three
parameters, no error** — and it emits `{ digest }` alone, while the
development build of the same function takes `error` and emits its name,
message and stack. `erroredTask` (`:1760`) passes a digest into it. On the
browser side, `resolveErrorProd()` takes **no arguments** and builds a fixed
Error reading "An error occurred in the Server Components render. The
specific message is omitted in production builds…". So the `err.message`
that twenty-two components fall back on is that paragraph, verbatim, about
RFI chronology and blank vendor names. The claim is true and cannot be
configured away.

**One refusal that did not exist at all, and this is the live defect.**
`MaterialOrder.vendor` has no `onDelete` in `operations.prisma`, so it is
RESTRICT. Deleting a vendor that is on a material order raised a raw Prisma
foreign-key error, which production redacts — so Remove appeared to do
nothing whatsoever, with no message and no clue. `deleteVendor` counts the
orders first and names them: "Desert Gypsum Supply is on 2 material orders,
so the record stays". Counted rather than assumed, and scoped to that
vendor, with a test for each — a guard that refused every delete would have
passed the other two.

**The catalog form's three money/hours inputs had no `type` at all**, so
they were text feeding a decimal parser. Typing `1,200` or `$2.85` — the two
ways a person writes a price — threw, and on that form specifically the
damage is the whole page: it is a plain `<form action={…}>` with no client
error handling, so the throw reaches the error boundary and every field
typed alongside it is gone. They are `type="number" step="0.01"
inputMode="decimal"` now: the step is what stops the browser ALSO rejecting
2.85, and the `inputMode` is the Android keypad that `type="number"` alone
does not guarantee. The server half of that one is `estimating.ts`, the
other lane, and is reported rather than done.

The check: 62 new tests that assert each message is RETURNED, with a helper
that fails loudly on a throw and says why. A test written
`expect(...).rejects.toThrow("Send this RFI…")` would have been green
throughout the entire life of this defect, which is exactly why none is
written that way. Two mutants run: reverting `answerRfi`'s draft guard to a
throw turned one test red with "THREW instead of returning"; downgrading
`punchLists`' `InputError` to a plain `Error` turned two red, which is what
proves the `runAction` boundary rather than the guard.
