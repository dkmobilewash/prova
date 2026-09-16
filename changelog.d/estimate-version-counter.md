### Two people saving an estimate version at once no longer lose one of them (Diego)
`claude/prova-company-cam-feature-6170v6`

Issue #289. `EstimateVersion.versionNumber` was `MAX(versionNumber) + 1`,
read outside any transaction — the LAST sequence in the product still
breaking CLAUDE.md's counter rule. Every other one already came from a
counter row.

**The reachable cost was the race, and it was not rare.** Two people saving
a checkpoint on one job at once — an estimator and whoever is checking the
numbers with them, or simply two tabs — both read the same max, computed
the same number, and the second violated `@@unique([jobId, versionNumber])`.
`saveEstimateVersion` returns void and does not catch, so that throw
reached the person as a redacted production digest with their checkpoint
gone. Measured against a real Postgres 16 before anything changed:

| concurrent saves | rounds losing at least one submit |
| --- | --- |
| 2 | 49 / 50 |
| 3 | 50 / 50 |
| 4 | 50 / 50 |

**The first two-way trial passed**, both submits landing as v3 and v4, and
it would have been easy to file this as theoretical. Fifty rounds put it at
98%. One trial is not a measurement, and this entry exists partly to say so.

**What was NOT wrong, recorded so nobody re-argues it.** The
reissue-after-delete failure — the vivid one, two different snapshots both
called Version 2 — is unreachable: nothing in the product deletes an
`EstimateVersion`, only the two teardown scripts do. That is the #224
lesson applied on purpose rather than rediscovered: a vivid failure nobody
can reach makes a bug look urgent for the wrong reason and the boring one
underneath goes unfixed. The boring one was the headline here. Also already
handled and not the problem: the single-tab double-click, which
`SubmitButton` has disabled since #19.

**The fix** is `EstimateVersionCounter` plus `issueEstimateVersionNumber`,
called inside the same `$transaction` as the insert. The issuer lives in
`lib/estimating/estimate-version.ts` rather than the action file, because a
`"use server"` file may only export async Server Actions — exporting a
counter bump from it would publish an internal as an endpoint. #280 is what
happens when an issuer stays private: a second writer never finds it. There
is one writer today; the module is still the right home.

The migration backfills from `MAX(versionNumber)` per job, the same
load-bearing line both existing counters carry — without it every job with
saved versions starts at 0, issues 1, and collides with its own history on
the first save. Announced in Slack before the push, per rule 4.

**A new per-job counter is three edits, not one**, and this one took all
three: `HANDLED_MODELS` in `scratch-scope.mjs` and the `del(...)` order in
both `clean-scratch-data.mjs` and `seed-demo.mjs`. It is a RESTRICT child of
`Job` that deleting the job's versions does not reach — #227's scar, which
#283 hit again from a new direction days ago.

**Three mutations, three caught**, files restored byte-identical by
`sha256sum`. Restoring the MAX path turns all five counter cases red.
Moving the bump outside the transaction turns exactly one red — the case
that fails an insert on purpose and asserts the counter did not move, which
exists only because the identical mutation SURVIVED in #283 and had to be
chased. Gutting the migration's backfill fails the suite at file level
through the `beforeAll` guard that asserts the SQL was really read: the
three backfill tests report as skipped rather than red, and the file fails,
which is what CI reads — recorded precisely because "skipped" and "passed"
are not the same word.

The migration is exercised by reading the shipped `.sql` off disk, not by
restating it. The Ask exclusion for `saveEstimateVersion` said "not exposed
to a retrying caller until it has a counter"; that condition is now met, so
the reason is rewritten rather than left as a sentence pointing at a defect
that no longer exists. It stays excluded — whether the box should save a
checkpoint is a product call nobody has made.

NOT CLICKED. Nobody has saved an estimate version in a browser against this;
it rests on the database tests.
