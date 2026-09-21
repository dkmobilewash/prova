### The numeric census now asserts that its parse meant something (Cyrus)
`cyrus/numeric-input-gate`

Test-only, and small: two cases and a header paragraph added to
`lib/numericInputCensus.test.ts`, the census #414 merged. No production code.

**This started as a competing gate and ended as two checks.** #423 and #414
reached the same three defects independently the same day. #414 got there with
the fixes attached and a better answer on two design questions, so its file is
the one on `main` and this folds into it rather than beside it. What survives
is the part its scanner did not cover.

**What the scanner was missing, found by mutating it rather than reading it.**
Two mutations of the merged census came back GREEN:

- **losing exactly one `<input>` repo-wide.** Its size check is a tolerance
  band — at most git's count, at least 80% of it — and a band cannot see a
  loss smaller than the band. The realistic failure is one tag with an
  attribute shape the walker mishandles, and that was invisible;
- **removing `withoutComments()` from the tag walk.** The count barely moves.
  Meanwhile eleven tags in this repo parse differently without it, because JSX
  permits a `//` comment between attributes and this codebase leans on that to
  explain why an attribute is *absent*. `BackchargeRow.tsx` reads "Deliberately
  NO `max={claimed}`, and now no `type="number"`" — a raw parse credits that
  element with both. `JobMediaCard.tsx` is worse: it carries a commented-out
  `<input type="checkbox">`, so a raw walk finds five tags where there are four
  and every later tag in the file inherits the previous one's attributes. A
  silent index shift behind a correct-looking count.

So the census now does exact accounting instead of a band — every `<input` in
the raw bytes is either a tag the walk parsed or is demonstrably inside a
comment, and nothing may be neither — plus a control that runs the same walk
over raw source and fails if comment stripping ever stops changing the answer.
The second one fails *vacuous* rather than passing if the repo stops putting
comments inside opening tags, instead of quietly answering an empty question.

Both mutation-tested from the other side: restoring either hole turns the new
cases red, and the single-tag loss is now caught at one tag.

**The generalisation, which is the part worth keeping.** This file already
asserts its SIZE (the `scratch-cleanup-order` scar) and its SCOPE (the
`theme-contrast` scar), and those are genuinely different failures. They are
not the only two. Size answers *"did the pattern stop matching"*; scope answers
*"was I looking everywhere"*; **neither answers "did the parse mean anything"**,
and a walk that silently misaligns its output satisfies both while being wrong.

**Two things #423 was wrong about, corrected here rather than left standing.**

Its rules required `type="number"` and `step="0.25"` on percentage fields.
#414 measured both in real Chromium and rejected them, and it is right on both
counts. `type="number"` submits an **empty string** for a value the browser
cannot parse — the HTML value-sanitization algorithm — so on a nullable field
the figure vanishes with no error at all, which is worse than a refusal. And
native `step` gates the submit handler silently; this repo has been bitten
twice and both scars are commented in place, verified rather than taken on
trust: `BackchargeRow.tsx` ("`max` fired Chrome's own message first, so that
sentence was unreachable") and `PayApplications.tsx` ("native validation gates
the submit handler, so the form silently refused rather than showing
anything"). A `step` rule would have re-introduced a documented scar. The
underlying point — that `min`/`max` cannot see `0.10` — stands, and #414's
answer to it, a persistent `%` in the box and a live money preview reading
"Withholds $105.00 of $105,000.00", catches every wrong value rather than only
non-multiples of a quarter point.

Its changelog also said `Infinity` and `1e999` reach Prisma. **On current
`main` they do not** — verified by executing the new parser, which refuses all
three of `Infinity`, `1e999` and `0x10` by name with a readable sentence. The
claim was true of the old `decimalFromForm` when measured, and #414's own
module header says the same thing about that parser; it stopped being true the
moment #414 merged. A claim about what the code does is perishable, which this
repo has written down before.
