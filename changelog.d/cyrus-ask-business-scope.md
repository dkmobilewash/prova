### Ask now knows what kind of contractor it is talking to (Cyrus)
`cyrus/ask-business-scope`

The three questions on `/welcome` — under GCs or direct for owners, public
work or not, monthly pay application or not — bought exactly one thing
until now: the sidebar hid three routes, and only ever on an explicit
"no". An agent read that and recommended deleting the screen, on the
grounds that three questions of friction is a lot to pay for some hidden
links. The other way to settle that is to make the answers worth more, and
this is the first of it.

Ask is told, in one short paragraph, how this business works. A sub who
said yes to public work and yes to monthly pay apps now gets answers
written for someone whose week contains prevailing wage and pay
applications. Somebody who contracts direct for owners and said no to both
stops being told about WH-347 as though it were his Friday chore.

**What it is not.** The `/welcome` screen promises on screen that "nothing
is removed for good: search and Ask can still reach anything", and this is
one of the two places that promise could quietly become false. So the
mechanism is deliberately the smallest one that could work: a string in the
per-request context, alongside the access line and the page hint. No tool
is added or removed, no tool result changes, and the offered tool list is
byte-identical for every set of answers — pinned by a test that asks for
the tool names four times over four different scopes and requires all four
lists to be equal. The paragraph itself tells the model the same thing in
words, with the worked example that would otherwise be got wrong:
certified payroll at a company that does no public work still gets a real
answer.

**The common case is a company that answered nothing** — skipped, or signed
up before the questions existed. It short-circuits on `hasNoScopeAnswers`,
the same function the nav filter and the profile line use, and gets no
paragraph at all: the context string handed to the model is `undefined`,
byte-identical to what a caller that never passes a scope produces. Both
arms are asserted.

**Cost, measured rather than guessed.** The paragraph is 900-930
characters for a company that answered all three — roughly 230 tokens
against the system prompt's ~2,670, so about 8% more prompt on a question
that calls no tool and proportionally less on one that does. Nothing at all
for a company with no answers. It rides the per-request half rather than the
cached half, so it is paid each time; the test caps the length so "one more
clause" stays a decision somebody makes rather than one that happens.

**No extra database read.** The answers come off the Company row the
session had already loaded in `/api/ask`, not from a second query on the
path a person waits through.

**Checks, each mutation-tested.** Six mutations were run: the context not
joined into the request, the promise sentence deleted, a "no" answer
silently producing no clause, the tool list narrowed by the answers, and
the two booleans swapped on the way off the Company row — all five went red
and named the right test. The sixth is worth recording because it came back
GREEN: removing the `hasNoScopeAnswers` short-circuit alone changes nothing,
because the `parts.length === 0` line below it catches the same case. That
is honest redundancy rather than a vacuous test — taking BOTH guards out
does make the all-null tests red, which is the version that proves the
behaviour is pinned. A mutation that passes is only good news once you know
which of the two it means.

One flake was fixed on the way rather than tolerated: the stream test
imported `answer.ts` inside its first test, so the transform cost of the
whole tool registry was charged against that test's 5-second budget and it
timed out on a diff that was correct. The import is at module scope now and
the database client is replaced by a proxy that throws, so the test cannot
quietly start needing a row.

**Not in this PR, on purpose:** Ask noticing that somebody needs a
capability they have not set up and offering it. Knowing the scope answers
makes that much better aimed, but it is a different piece of work — it
needs the empty-register and getting-started reads to decide what to offer,
and a rule for how a suggestion stays grounded in features that exist. Half
of it would be worse than none.
