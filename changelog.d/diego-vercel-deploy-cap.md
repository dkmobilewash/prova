### The deploy limit is 100 a day, on the ACCOUNT, and skipped builds count

Production sat five merges behind for two hours — #775, #804, #805, #806 and
#601, four of them Cyrus's — while branch previews kept deploying normally.
Every merge to `main` produced no deployment at all. The dashboard then named
the cause:

```
Resource is limited - try again in 24 hours
(more than 100, code: "api-deployments-free-per-day")
```

**CLAUDE.md said this was NOT the daily cap**, on the evidence that only 17
deployments existed in the 24 hours before an earlier refusal, and concluded
it was an unpublished BURST limit with no number worth writing down.

The reasoning was sound and its premise was too small. **The cap is on the
ACCOUNT, and that count was one project.** On the day it fired: 61 deployments
in 18 hours across FOUR projects, of which `prova-web` was 22. Looking at one
project can never find a ceiling three others are also pushing against — the
same shape as a census with the right pattern and the wrong scope.

**And the skipped builds still count**, which undoes an optimisation recorded
two paragraphs later as a saving. `apps/lien-waiver`'s `ignoreCommand` works
exactly as intended — 17 of its 19 deployments are `CANCELED` — and all 17
still counted. The saving is build MINUTES, not deployment QUOTA: 28% of that
day's deployments were skips that bought nothing against the thing that
actually stopped the work.

So the lever for quota is fewer deployment EVENTS: auto-deploy off where a
preview per push is not wanted, batched pushes rather than one per commit, or
a plan without the cap. Recorded because the next person to hit this will
otherwise go looking for a burst limit that does not exist, on a project that
is only a third of the problem.
