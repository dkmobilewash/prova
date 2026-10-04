### What actually changed, in plain English (Cyrus)
`cyrus/e2e-verdict-annotations`

**The one number that says whether a red `e2e` run means anything was the
hardest number in CI to get.** `verdicts.mjs` is the guard behind this repo's
"absence of a failure is not a pass" rule: it requires the count of verdicts
returned to equal the count collected, and every one of them to be `expected`.
It was working correctly and saying so almost nowhere. A failing `e2e` job's
only check-run annotation was `Process completed with exit code 1`, and
`verdicts: collected N, returned N` lived solely in the job log.

That matters because of where the log lives. Both the job log and the
Playwright report artifact download redirect to `*.blob.core.windows.net`,
which an agent container's egress proxy refuses at CONNECT — measured today on
#532's and #601's `e2e` jobs, `gh api …/logs` and `…/artifacts/<id>/zip` both
returning zero bytes. So from a container the question *"is this red run main's
known #418 baseline, or did it prove nothing?"* was unanswerable, and the
answer is the whole basis of the merge gate. For the person this suite was
built for it was worse than unanswerable: nobody reads a 1,600-line log tail to
find one line.

The check-run **annotations** API needs no blob host and is reachable. So the
script now emits its findings as `::error::` workflow commands as well — the
count mismatch, and each test that did not return `expected`, by name and with
its first error line. They show on the PR and come back from
`/repos/{owner}/{repo}/check-runs/{id}/annotations`. Ten at most, because that
is what GitHub displays per step, with a line saying how many were not shown.
Gated on `GITHUB_ACTIONS`, so a local run reads exactly as before. **No
workflow edit**, which is deliberate: `.github/workflows/` is unpushable from
Cyrus's keyring until `gh auth refresh -s workflow` is run, and this needed to
not depend on that.

**And writing the test for it found a live injection route in the half nobody
was watching.** GitHub parses *any* stdout line beginning with `::`. The
human-readable report printed `v.title` raw, so a spec title containing a
newline — a title built from a template literal is all it takes — ended the
report line and let whatever followed be read as a workflow command. A title
of `step 11\n::error::forged` really did produce a second annotation. Not in
the new escaping; in the existing plain-text output, which had no escaping
because nobody had thought of it as output a machine parses. Fixed by flattening
every title and error to one line at construction: one verdict is one line,
which is now a safety property rather than a formatting choice. The annotation
escapes `%`/`\r`/`\n` on top of that, and `:`/`,` in the `title=` property
only — the message needs none, because command parsing is anchored at the start
of a line, so a mid-line `::` is inert.

Two things the test got wrong before it got it right, both worth the line.
It first asserted the newline arrived via the error message; it cannot, because
the script already reduces an error to `message.split("\n")[0]`. Then it
asserted the forged title would be `:`-escaped inside the message; it is not,
and should not be. Each wrong assertion was a wrong belief about the mechanism,
corrected against what the script actually printed rather than argued.

The check: `apps/web/e2e/verdicts.test.ts`, 11 tests, which spawn the real file
and read its stdout and exit code — all CI ever reads. Six mutations, each
confirmed as landed on disk before its result was read, each red: the
annotation block disabled (8 red), the `GITHUB_ACTIONS` gate dropped, `%`
escaping removed, `oneLine` dropped from the title, the ten-annotation cap
removed, and the count-mismatch annotation silenced. Baseline and full restore
both green at 11/11.

Not run here: the repo's own `pnpm install --frozen-lockfile` still dies on
`cdn.sheetjs.com`'s `xlsx` tarball with `ERR_PNPM_FETCH_403`, leaving
`apps/web/node_modules` empty, so these 11 were run under a standalone
`vitest@3.2.7` — the same minor the repo pins — against the real file. The test
imports only `vitest` and Node builtins, so there is nothing in it that CI
resolves differently. CI's own `ci` job is the instrument for that, and the
first red `e2e` after this lands is the instrument for the annotations.
