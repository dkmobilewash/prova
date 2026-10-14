### Nine builds in ten were rebuilding an app whose files had not moved

Vercel refused three successive merges to `main` on 2026-10-13 with "Deployment
rate limited — retry in 24 hours" (`?upgradeToPro=build-rate-limit`), so #776 and
#777 landed with **no deployment at all** and production had to be built by hand.

The limit is real and the first diagnosis of it was wrong. It is not the Hobby
*daily* cap: only **17 deployments existed in the 24 hours before the refusal**,
and all nineteen of that day's sit inside a four-and-a-half-hour window, six in
the hour before it. It is a burst limit, on `plan: "hobby"` with
`concurrentBuilds: 1`. Vercel publishes no threshold, so none is written down.

**What was feeding it.** Neither `vercel.json` had an `ignoreCommand`, so every
commit to the monorepo built *both* projects. Measured over `main`'s last 30
commits: **27 changed nothing `apps/lien-waiver` depends on.** Nine builds in ten
were spent rebuilding a marketing tool whose files had not moved — while the
product's own merges were being refused for going too fast. With one concurrent
build they also queue, so each push took twice as long to go live.

`apps/lien-waiver/vercel.json` now skips those:

```
git diff --quiet HEAD^ HEAD -- :/apps/lien-waiver :/pnpm-lock.yaml :/package.json
```

**The pathspec is exactly three things because that is the whole input set.**
`apps/lien-waiver/package.json` declares **no workspace dependency** — every
dependency is an external package, checked rather than assumed — so nothing under
`packages/` can change this build's output. What remains is its own directory and
the two manifests that can move a resolved version underneath it. The `:/` prefix
makes each path repo-relative, because Vercel runs the command from the project's
root directory where `.` means something else; verified by running it from both
places and getting the same answer.

**Verified against real commits, in both directions**, which is what caught a
bad test case: `4c9a33f0` (web only) exits 0 → skip; `ab88ae86` (a real
lien-waiver change) exits 1 → build. A missing `HEAD^` exits **128** → build, so
it fails towards building, which is the cheap direction.

### apps/web deliberately gets none of this

A skipped build leaves the previous deployment serving, so a project that skips
can sit behind `main` — indistinguishable, from the page's own `dpl=` stamp, from
the deploy failure that produced this change. The saving is taken only where
being a commit behind costs nothing. `deployTrigger.test.ts` pins the asymmetry.

### Verified

`vercel.json` cannot carry a comment and the polarity is invertible in a way that
fails silently in both directions, so the reasoning lives in
`apps/lien-waiver/lib/deployTrigger.test.ts`. Six mutations red: the command
removed, the polarity negated, `--quiet` swapped for `--exit-code`, the lockfile
dropped from the inputs, a pathspec made working-directory-relative, and
`apps/web` allowed to skip.
