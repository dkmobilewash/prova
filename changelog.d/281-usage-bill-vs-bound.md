### The settings page printed one number and meant another (Diego)
`claude/prova-ai-task-completion-96pjes`

Found by an audit of every AI feature in the app, run before planning the
next phase of the assistant. Two findings and one guard, no schema change.

THE BILL AND THE BOUND WERE THE SAME NUMBER, AND THEY ARE NOT THE SAME
THING. `AskUsage.feature` arrived on 2026-09-14 so the three non-Ask model
callers — WIP narrative, document extraction, estimate drafting — would stop
spending invisibly. `askAllowance` was filtered to `feature: "ask"` the same
day, and that filter is right: its own comment puts compliance extraction at
$2.25-$4.50 a call and says a row count is the wrong instrument for it.

The READING side was never filtered. So `/settings/assistant` summed all four
features, printed the total as "N questions sent to the model", and put the
Ask-only limits in the very next clause. Two numbers over different row sets,
touching, with nothing to say they were different — a company running document
extractions saw a question count it could not reconcile against a limit those
rows never counted toward. And the per-feature attribution the column was
added for was not on the page at all: the column was written and never read,
which is this repo's most familiar shape.

The page now says what it means: total model calls and tokens (the bill),
a per-feature breakdown (so it reconciles against the Anthropic invoice),
then the Ask question count beside the limits that actually bound it, saying
plainly that the other features are not counted against them. One `groupBy`
over `["userId", "feature"]` serves both breakdowns, on an index the schema
already had.

A FEATURE NOBODY HAS LABELLED APPEARS UNDER ITS OWN NAME. `FEATURE_LABELS` is
a lookup with a fallback, not an exhaustive `Record`: a fifth caller shows up
on the page the day it ships rather than the day somebody remembers it. A set
that silently shrinks is what this repo keeps paying for.

THE GUARD THE COUNTER CENSUS COULD NOT PROVIDE. `counterCensus.test.ts` asks
whether every counter is bumped, inside a transaction. It cannot ask whether
every writer of a NUMBERED TABLE goes through its counter — which is why
#280 shipped with `ContractDocument` having two writers and two numbering
schemes while the census stayed green. The numbered-table census asks from
that end. Its counter → table map cannot be derived (`SafetyCaseCounter`
numbers `SafetyIncident`, and no naming rule gets you there), so its keys are
pinned to the schema's own counter list: a new counter fails the build until
somebody writes down what it numbers, and the declaring is the review. Run
across all nine it found no further divergence — both `changeOrder` writers,
both `invoice` writers and the rest already route through their helpers.

The unit suite's fake now REFUSES a duplicate `(jobId, versionNumber)` the way
Postgres would. It was accepting one, so a reintroduced MAX-path defect could
reissue a number and the fake would agree.

MEASURED. Reverting the feature filter turns the new cases red with
`expected 14 to be 9` — the inflation itself — while eleven pre-existing usage
tests stay green, which is the measurement explaining how the drift survived
the change that introduced it. Reverting the numbering turns the census red
naming the file and the helper. Each mutation was reverted and confirmed
byte-identical by sha256sum.

FEATURE-AUDIT Sheet 23 described the old page and Sheet 24 said "five shipped
features now call Claude" — a count of product surfaces, not call sites. There
are four functions; Ask's two halves are one of them. Both rows corrected with
the evidence, and `/intake` recorded as NOT a model caller despite the name:
it is the review tray over what the extraction already produced.

Typecheck 0, lint 0 errors, 187 files / 3187 unit tests, 38 files / 441
database tests against a real Postgres 16, production build exit 0.
