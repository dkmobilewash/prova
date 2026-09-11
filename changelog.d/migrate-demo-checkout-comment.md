### The demo-migration button's header said it needs no checkout, and it does — AUDIT, docs only (Diego)
`claude/prova-company-cam-feature-6170v6`

`migrate-demo.yml`'s header explains why the workflow exists rather than
"run the script locally", and its first reason was `It needs no checkout,
no Node, no pnpm`. All three clauses are false about the workflow. The job
forty lines below runs `actions/checkout@v4`, `pnpm/action-setup@v4`,
`actions/setup-node@v4` and `pnpm install --frozen-lockfile` before it can
call `migrate:deploy` — and it has to, because the migrations it applies
and the script that applies them are both files in this repository.

What the bullet MEANT is true and is now what it says: nobody's laptop
needs a toolchain, which is the whole argument for a button.

The correction is worth a commit rather than a quiet reword because of
what the false version conceals. A checkout has a ref, and **the job
applies the migrations present on the ref you pick in "Use workflow from",
not the ones on `main`.** A reader who believes there is no checkout has no
reason to think the dropdown means anything. It does, in both directions:
run 16 was dispatched from `claude/prova-company-cam-feature-6170v6` on
purpose, to put #214's unmerged migration on the demo project so its
preview could be clicked, and a run from a stale ref is one that reports
success having applied less than whoever pressed it assumed. Neither is
distinguishable from the green tick — only the migration NAMES printed by
`Apply and verify` tell them apart, which is what the header now says.

Comment-only: `git diff` on the file adds no non-comment line, and the
YAML still parses to the same eight steps and the same required
`expect_host` input. No behaviour change, and nothing to click.

One claim checked and dropped rather than shipped: this was first written
citing demo run 14 as a case where the dropdown had gone wrong. It was
not. Run 14 was dispatched from `main` at `0312467`, which was `main`'s tip,
and correctly applied #213's migration and nothing else. The hazard is
real and documented in #214's own commit message; the example was mine and
was wrong, so it is gone. A correction that invents its evidence is worse
than the sentence it replaces.
