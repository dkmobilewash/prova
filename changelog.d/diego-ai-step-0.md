### A company can now say no to AI, and each feature knows which model it runs on (Diego)
`diego/ai-step-0`

Nothing in this app could turn AI off for one company. What gated it was, in
order: a server-wide `ANTHROPIC_API_KEY`, per-person capabilities, courtesy
rate limits, and a paid monthly allowance — so the only way to stop the
assistant for one customer was to stop it for everybody. A contractor who
wants their drawings kept away from a model had no answer, and we had none to
give them. `/settings/assistant` now carries the switch: a master toggle, one
box per feature, and the page's own header no longer says "nothing on this
page writes", because that stopped being true.

**Absent means ON, deliberately, and it is the one default here worth
arguing about.** Every existing company has no settings row on the day this
migrates. Defaulting to off looks like the careful choice and would switch
the assistant off under every customer at once, with nothing on screen saying
why. Off is a decision somebody makes, not a state they inherit.

**The gate fails CLOSED, which is the opposite of the rate limit next door,
and the two are not a copy of each other.** `askAllowance` fails OPEN on
purpose (#257): a counter that will not read should not stop a person
working. This switch answers a contractor who said their documents must not
reach a model, and a switch that opens when it cannot read itself has not
kept that promise — it has kept it most of the time. It refuses in a
sentence rather than throwing, because production redacts a thrown Server
Action message to a digest and a deliberately-disabled feature must not
surface as "something went wrong".

**The check that makes it a fact rather than an intention** is
`aiFeatureGateCensus.test.ts`. It reads the model-calling functions out of
`packages/integrations` — every `messages.create`/`messages.stream`, each
attributed to the feature its own `model:` resolves to — then requires every
app file that IMPORTS one to gate that feature. Both ends are derived, for
two different scars: a pattern that silently matches nothing (#224, where a
guard went green on 180 foreign keys when the answer was 181) and a scope
that never walks the offending file (#265, where nothing is ever missing from
a directory you do not look in). Comments are stripped with a string-aware
scanner, because two files NAME a model caller in prose and a raw-text
census would have demanded a gate in two files that make no model call — the
#185 shape. Mutation-tested four ways: gate removed, gate present only in a
comment, the pattern pointed at nothing, and a feature with no enum member.
Each goes red naming the file.

**`claude-opus-5` was written inline in six places** with no env var and no
config, so changing a model meant a code change and a deploy, and trying a
cheaper one on high-volume work was not possible at all. `models.ts` now
resolves it per feature — company override, then
`ANTHROPIC_MODEL_<FEATURE>`, then `ANTHROPIC_MODEL_DEFAULT`, then the
feature's default — and an id nobody recognises is IGNORED rather than passed
through, because a typo'd override would 404 on every call and reach a person
as "the assistant is unavailable", the same screen as a missing key with
nothing naming the cause.

**Every usage row now records the model that actually ran.** All six wrote
`ASK_DEFAULT_MODEL`, which was correct only while every feature shared one
model — they no longer do. Nothing prices that column today; the cost
measurements coming next will, and a Haiku call recorded as Opus is a
five-fold overstatement waiting for the first person to multiply it out. Rows
also carry `jobId` now, so "which jobs is this AI bill going on" is
answerable; it is a plain column and not a foreign key, because a spend
ledger must not lose its history when a job is deleted.

**Two bugs found while wiring it, both by writing the thing that would
catch them.** A disabled checkbox posts nothing, so turning AI off would have
recorded all seven features as switched off and destroyed the company's
per-feature choices — hidden inputs carry them through. And the settings form
imported the module that reads the row, which put a Prisma client in the
browser bundle; `client-prisma-boundary.test.ts` caught it within a minute,
and the labels now live in a database-free `lib/ai/features.ts`.

**One consequence stated rather than buried:** with document reading switched
off, a compliance document cannot be FILED at all, because the upload is the
only path and the required type and party come out of the extraction. The
refusal says so in as many words. A manual-entry path is the fix and is not
in this change.

Migration `20260926234539_add_company_ai_settings` is fully additive — one
enum, one table, four columns, two indexes, two foreign keys — so the
expand/contract window this repo has an outage scar for (#378) does not
arise: the running build selects none of it.
