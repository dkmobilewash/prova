### Naming a migration target and having nothing to check it against is now fatal (Diego)
`claude/prova-contractor-os-e3f0iz` — issue #182

`wrongTarget()` is the assertion that answers "is this the database you
SAID you meant?", which is a different question from "do these two URLs
agree with each other" and the only one that catches a secret holding the
wrong connection string. It had two ways to return "no problem", and only
one of them was a decision.

The decision: no name given, so nothing was promised, so nothing is
asserted. That is deliberate and unchanged — production's migrate job
predates the guard and silently breaking it to add one would be a poor
trade.

The defect: a name given, but no connection string readable at all. It
returned null too, so the caller saw the same value it sees when the
target is confirmed correct. That is this repo's most expensive shape,
written down three times in CLAUDE.md already — the census a comment
disarmed (#185), the SQL parser one line break from seeing nothing
(#224's migration), the verify agents whose deaths were counted as
refutations. **A check that derives its input can get the answer wrong or
get an empty question, and only the first one looks like a failure.**

It is fatal now, and the message says which of the two happened: "the
assertion you asked for did not run", not "the target was correct".

**Reachability, stated rather than buried, because it changes what this
fix is worth.** The branch is UNREACHABLE today. `migrate-deploy.mjs` is
the only caller, and it exits on any fatal problem — including an
unreadable `DATABASE_URL` or `DIRECT_URL` — before it ever reaches
`wrongTarget`, so both arguments are guaranteed non-null at the call
site. Both workflows also supply a name: `migrate.yml:97` hardcodes
`ep-little-sea-a6bdnaw2`, and `migrate-demo.yml` marks its input
`required: true` behind a shape check.

So nothing in production was exposed, and saying otherwise would be the
"vivid failure nobody can reach" the #224 entry warns about. What was
actually wrong is that the thing keeping it shut is an invariant in the
CALLER that nothing states and nothing tests. A second caller, or a
relaxed exit above it, makes the assertion vacuous with every check still
green — which is precisely how the guard fails in the way that does not
look like failing.

**The check:** four new cases in `db-target.test.ts`, mutation-tested in
both directions. Restoring the old `return null` turns all four red and
leaves the twenty existing cases green, so the fix changes nothing else.
Turning the opt-in into a hard requirement turns the opt-in case red, so
the deliberate half is still pinned rather than accidentally covered by
the new half.
