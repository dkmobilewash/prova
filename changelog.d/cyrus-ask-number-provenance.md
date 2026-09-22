### Ask can no longer say a number it cannot trace back to your records (Cyrus)
`cyrus/ask-number-provenance`

The system prompt has said "Never do arithmetic" since the Ask box was built,
and that instruction has already been broken in production: it answered "three
overdue invoices" and listed four, against a dashboard tile reading four. A
prompt line is a promise. This is the check.

**The rule.** Every number an answer says out loud has to appear in a tool
result from that same question, or in the question the person typed. One that
does not gets the whole answer held back, with a sentence saying so — not the
figure with a warning under it.

**It is the foundation for a later change, not the change itself.** Cyrus wants
the box to combine several tool results into ordinary prose rather than
answering one question from one tool. Prose composition is where an invented
figure becomes easy, so the safety catch goes in first and separately. Nothing
about which tools exist, what they return, or how the box answers has changed
in this PR.

**The measured false-positive rate is ZERO, out of 43 legitimate answers
carrying 153 numbers.** That figure is the point of the change and it is a
test, not a claim: `lib/ask/provenance.corpus.ts` holds an answer for every
shape that breaks a naive matcher — thousands separators, a trailing-zero cent
figure written back from `1173.7`, the floating-point hour sum
`render-hours.ts` exists for, percentages the handlers pre-format as strings,
dates in three spellings, phone numbers, sheet sizes, OSHA case numbers, a
number the person typed, a tool's own refusal sentence quoted back, and answers
with no tool call at all. The questions are taken verbatim from the
hundred-question census and asserted to still be there; the tool text is built
by `toolResultContent`, the executor's own function, so the bytes are the bytes
the model is handed; the money and hours are rendered by `lib/money.ts` and
`lib/render-hours.ts` rather than typed out, so the formatter and not a guess
decides what reconciles.

**The rounding rule, which is the judgement call.** A figure written with `p`
decimal places accounts for a source value when it is that value rounded to `p`
places — half a unit of the last digit actually WRITTEN. So "about $47" from
46.95 passes and from 46.50 passes; 46.49 does not, and 41.20 does not. Both
sides of the boundary are pinned, because a tolerance only means something if
its far side is tested. It deliberately refuses "about $47,000" from 46,950:
that string is written to the units place, and reading it as one significant
figure would let it stand for anything in [46,500, 47,500) on a number somebody
takes to a GC.

**Almost nothing is exempted, and that is the design.** The obvious approach is
to skip dates, years, job numbers and phone numbers as "not really figures".
Backwards: the prompt already says every fact comes from a tool, so those pass
because they are in the tool text — and one that is NOT in the tool text is a
fabricated deadline, which is worse than a fabricated dollar. What differs is
the KIND of match. A plain number is matched by value, so formatting cannot
break it; anything joined by `/`, `-` or `:` is matched by its digit groups
appearing literally, which is every date, phone number and sheet size the app
produces. The only thing ignored outright is a numbered-list marker.

**What it cannot do, written down rather than discovered later.** A count
spelled out in words carries no digits and is invisible — that was the original
defect and what fixed it was `forModel` putting a `count` in every rowed result.
Small integers are barely guarded, because forty rows of anything already
contain most integers under thirty; the guard is strong exactly where the money
is. Web-search answers and answers about an attached file are skipped entirely,
by name, because their real source never reaches this process and every honest
one would be refused.

**What a person sees when it fires.** The answer is retracted, using the
mechanism the loop already has for a half-written turn: an `error` event, which
clears the answer in `AskPanel` exactly as `exhausted` and an API failure do.
No citations, no transcript entry, and no prior turn the next question could
quote — all three hang off `done`, which never fires. Said plainly: the text
IS on screen while it streams, because the guard needs the whole answer and the
whole answer is not known until the model has finished writing it. Buffering the
last pass instead would add its full streaming time to every GOOD answer to
spare a rare bad one a second on screen.

**Where the firing rate is.** `/settings/assistant`, under Usage — how many
answers were held back in the last thirty days, counted from the same AskUsage
rows as everything else on that page, with "none" said as words rather than
left blank. A guard whose firing rate nobody can see is a guard nobody trusts:
at zero for a month it is either working or broken, and those look identical
from outside. The FIGURE is deliberately not on that page — it was held back
precisely because the app could not vouch for it — and goes to the runtime log
with the question instead. No migration: `outcome` is a free-form column so a
new reason needs none, which is what it was made free-form for.

**Three assertions about the check itself, and CLAUDE.md has paid for all
three.** SIZE: the total number of claims across the corpus is checked against
a literal, because an extractor that matches nothing refuses nothing and
reports a perfect false-positive rate — breaking it makes the headline figure
look BETTER. SCOPE: `provenanceScope.test.ts` pins that the string checked is
the string `AskPanel` puts on screen, by census over the component's own
reducer. PARSE INTEGRITY: every digit character in every answer must belong to
exactly one claim, so a tokenizer that quietly stops covering the text fails
loudly instead of shrinking the set.

**Mutation-tested, five ways, each restored and re-checked green.**

| mutation | result |
| --- | --- |
| the extractor matches nothing | size assertion RED — `expected +0 to be 153`; coverage RED — `receivables-cents left digits unclaimed: expected +0 to be 17`. **"Blocks none of them" stayed GREEN**, which is the whole reason the size assertion exists |
| thousands separators no longer stripped | **15 of the 43 legitimate answers refused**, named one by one in the failure message |
| the guard never refuses | 17 tests RED across the rule and the wiring |
| the rounding window widened 1000× | 4 RED, including `refuses $47 from 41.20 — the case this guard exists for` |
| the screen mirror stops honouring `reset` | 2 RED: a half-written answer the panel throws away became part of what the guard reads |
