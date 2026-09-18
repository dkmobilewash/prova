### The ask box can do sixteen things and advertised none of them (Cyrus)
`cyrus/ask-page-context`

A construction manager reviewing C Stream concluded the assistant could not
act at all. He was wrong, and he was reading the only evidence he had.

`lib/ask/` holds **sixteen write commands**, wired and live, with a
propose → card → tap-to-confirm shape the system prompt describes in full.
`create_estimate_job`, `draft_estimate_lines`, `draft_invoice`,
`log_payment`, `release_retainage`, `raise_rfi`, `add_punch_items`,
`log_daily_field_report`, `log_time_entry`, `send_email` and six more.

Two things hid all of it, and both are fixed here.

**Every example in the empty state was a QUESTION.** "What's overdue…",
"Which drawings…", "What's left…", "Anything expiring…". So the first thing
anybody learned about the box was that it answers things. Two of them are
now instructions — "Start an estimate for a new job" and "Log today's field
report" — and both still obey the older rule these examples were written
under: an example that comes back with "I don't have that" teaches people
the feature is broken. The first requires nothing that must already exist; a
name is its only required input. The second resolves the job from the page
when you are standing on one (the page-context work on this same branch) and
otherwise asks which — **the clarify path working, not a broken promise. A
question back is not a failure.**

`EXAMPLES` moved to `components/askExamples.ts`, a plain module, for the
reason CLAUDE.md records against `Hint.tsx`: a constant exported from a
`"use client"` file crosses the RSC boundary as a client-reference proxy
rather than as its value. `components/hintTiming.ts` is the same fix.

**And a refusal was a dead end.** The prompt's `WHEN YOU CANNOT ANSWER`
section said to say so plainly, say why in one clause, "and stop" — which is
exactly right about a NUMBER the app does not hold, and wrong about a THING
the app does not do. Those are different failures and only the first should
end the conversation. The prompt now distinguishes them: if the app does not
do what was asked, name the nearest thing it does, concretely and by name.
*"There are no purchase orders here. I can record a material order against a
job and log its deliveries."*

**The rule about facts is untouched and must stay that way.** Naming a
capability is not offering a substitute figure, and the prompt says so in the
same breath: offer an adjacent ACTION, never an adjacent ANSWER. A person who
takes an approximate number to a GC mis-bids a job. There is a test asserting
the original sentence still stands, precisely because the dangerous direction
here is a future edit that reads "be more helpful" and softens it.

**Mutations**, each watched red and restored:

| broke | result |
| --- | --- |
| reverted the examples to all-questions | **RED**, and the message names every example |
| stripped the near-miss rule from the prompt | **RED** |
| deleted "offer an adjacent ACTION, never an adjacent ANSWER" | **RED** |

The first is the one worth having: "all the examples happen to be questions"
is invisible to typecheck, lint and every other test in the repo, and it is
how this shipped in the first place.

test 3215/3215 (191 files), lint clean, typecheck clean, build green.
