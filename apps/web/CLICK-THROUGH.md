# This branch exists only to produce a preview URL

`diego/click-through` is a throwaway branch sitting at `main`'s tip. It is for
clicking the estimating features through a **preview** rather than production,
and it is never merged. Delete it when the click-through is done.

## Why a preview and not `app.cstream.ai`

Previews resolve `ep-patient-lake` — the demo project — while production
resolves `ep-little-sea`, which holds the real 14 jobs. CLAUDE.md is explicit
that previews "are what browser testing should point at", and it records what
the alternative costs: stray `ZZ-TEST` rows written to production on 4–5 Sep
2026 sat in the live `/sales` pipeline band inflating real figures, and one of
them corrupted a timing measurement two sessions had already spent days on.

Clicking here writes nothing real and needs no cleanup.

## Why this file exists at all

An empty commit gets no deployment. Vercel skips builds for projects a commit
does not affect (`vercel.com/docs/monorepos#skipping-unaffected-projects`), and
two empty commits on this branch were CANCELED for exactly that reason before
anybody looked at `errorLink` on the deployment. A branch pointing at `main`'s
tip gets nothing either, since Vercel dedupes by commit SHA and `main`'s own
deployment already exists.

So the branch needs a commit that touches something under `apps/web`. This file
is that commit, and saying so here is cheaper than rediscovering it.

## Before you click

A preview runs the Clerk **Development** instance, not Production. Being signed
into `app.cstream.ai` does nothing — sign in on the preview separately; its
sign-in box says "Development mode" in orange.

If the preview then shows you **no jobs**, that is not a broken feature. An
email with no row in the demo database falls through to a brand-new empty
company named "<Your Name>'s Company", and every list shows its empty state.
Run the **Seed demo data** workflow.
