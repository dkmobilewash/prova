### The Ask box can be operated: a connection check on its settings page, what every question cost, a limit per person and per company, and a routing eval (Diego)
`claude/prova-ai-task-completion-96pjes`

Phase 3 shipped with nothing that told an owner whether the box could
reach Anthropic, what it was costing, or whether anything bounded that
cost. Yesterday's click-through lost an hour to exactly the first gap: a
key saved after the preview build was created never reached the running
functions, every ask said "The assistant is unavailable right now", and
the only way to learn why was an agent reading Vercel's runtime logs. This
is the operating layer that was missing.

**`/settings/assistant` now says whether a key is configured and has a
"Check connection" button.** The button asks Anthropic's Models endpoint
for the model the box runs on — one request, no tokens billed — which
validates the key and the organization's access to that model at once.
The API's answer becomes a sentence that says what to fix: a rejected key
(401), an organization that cannot use the model (404), a rate limit
(429), an outage (5xx), or no key at all, that last one with the
redeploy caveat spelled out. Owner-only through #237's `ownerRefusal`, so
a non-owner reads a sentence rather than a redacted throw.

**Every question that reaches the model writes one `AskUsage` row** —
migration `20260911014306_add_ask_usage`, one table, additive, RESTRICT
to Company like AskProposal and SET NULL to User like every actor column.
The provider loop now reports the summed usage of every pass once,
immediately before its terminal event, and it reports it before an error
too: the passes that ran were billed regardless. The settings page reads
the same rows back as the last thirty days by person.

**The rows are the bound.** Before a question goes to the model,
`askAllowance` counts rows in a rolling hour for the person and a rolling
day for the company, and refuses in a sentence when either is at its
limit. Rows rather than tokens, so a question that fails is bounded
exactly like one that answers — a loop hammering the route with a bad key
is the case it exists for. The limits are a judgment call and one
constant to retune: sixty an hour per person, five hundred a day per
company, both stated on the settings page beside the usage they bound.

**A routing eval, run by hand, never by CI.** `pnpm ask:eval` sends the
model exactly what the route sends — the same prompt, the same access
context, the same offered tools for that principal — and grades the FIRST
round of tool calls: the right read tool, the right command with the
person's words in the right fields, or no card at all for everything the
registry deliberately does not offer and for every injection attempt.
Every executor call halts, so one model call per case and no database
touched. The cases are SYNTHESIZED from the click lists and the registry,
and say so in the file: a seed for the person who runs the box daily to
correct, not a benchmark. What CI does check is the cases themselves —
every expected tool and command exists and is offered to the principal
asking, every tool and command is covered, and the set stays above
thirty — so the eval cannot drift from the registry between runs. The
runner refuses to run without a key rather than passing on nothing, and
its last test requires one verdict per case.

**Verified, and how.** Unit tests pin the limit refusing at the number
and not before, the row written with the loop's exact totals, a failed
row write swallowed with the answer already streamed, the usage event
summed across passes and emitted before `done`, `halt` and an error, and
every connection sentence. A db test proves the rows `recordAskUsage`
writes are the rows `askAllowance` counts, over the windows it counts
them. The eval itself has NOT been run from here — no key in this
container — and the changelog does not claim a score it does not have.
