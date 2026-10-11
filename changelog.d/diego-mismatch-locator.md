### An instrument that names the element #510 disagrees about (Diego)
`diego/mismatch-locator`

CLAUDE.md's #418 entry ends on exactly this. Nine mechanisms eliminated, two
fixes shipped, and the residual mismatch fires on about one authenticated page
load in three — but **nothing says which element the two sides disagree about.**
Production React puts #418 on `pageerror` with `args[]=HTML` and prints no diff
and no component stack, so the error itself never will.

The entry's closing line: *"what is needed next is a PRODUCTION-mode instrument
that can identify an element without React's help — and the honest state of it
is that nobody has designed one."*

This is that instrument.

#### How it gets what the error refuses to give

React's message says what it does about a mismatch: *"the tree will be
regenerated on the client."* That regeneration is a DOM operation — a subtree's
children torn out and rebuilt — and a `MutationObserver` installed before the
page's first script sees it happen.

The technique is already proven here rather than hoped for. #501 installed one
and caught content moving "in the same millisecond as one of the #418s". That
investigation drew the **wrong conclusion** from it — the move was React
completing a large outlined Suspense boundary, which is deterministic and
harmless — but the instrument saw a real DOM event at the right moment. What was
missing was telling the benign move from the regeneration.

**It works.** Control, three loads out of three:

```
CONTROL load 1: caught #418, 3 non-boundary mutations
   +0.8ms  -1/+0  body.min-h-screen.bg-canvas
```

The container, 0.8 ms from the error, one child torn out.

#### Two things made it readable, and both are the point

The first version reported **476** "non-boundary" mutations a load and buried
the answer. Reading what they were:

- **`<head>` and detached nodes.** Script and link tags arriving, and nodes
  mutated while outside the document. Neither can be a regeneration — React
  regenerates a subtree that is *in* the tree, under `<body>`.
- **Insert-only mutations.** A regeneration REMOVES. Ranking by removals puts
  the answer first; an add-only mutation is a portal, a script, or Clerk
  mounting, all of which happen constantly and none of which is this.

3 mutations instead of 476, with the right one at the top.

#### And running it found something that narrows the file's conclusion

On a laptop, production build, signed in, across the four pages #510 names:
**24 of 24 loads hydrated, ZERO mismatches.** At the rate CI reports that is
p ≈ 0.0001, so it is a real difference rather than a quiet sample.

|  | production | dev |
| --- | --- | --- |
| a CI runner | **3–9 pages** | 0 |
| this laptop | **0** | 0 |

The entry currently concludes *"the defect is the BUILD, not the machine"*. That
was the best reading of the evidence available then, and this table is narrower:
**the build is necessary and not sufficient.** A runner differs from a laptop
most obviously in being slower, which is exactly what makes a race land
differently — and the surviving mechanism, Flight's 3,200-byte deferral, is a
race between a deferred row arriving and hydration reaching it.

So the locator only has something to look at on a runner, which is why it ships
with a workflow rather than as a command somebody runs.

#### Where it lives, and why it cannot turn CI red

`e2e/probes/`, which the gating suite's `testDir: "./specs"` cannot see, and a
`workflow_dispatch`-only workflow — the same shape as `hydration-probe.yml`. A
diagnostic that can fail a PR is not a diagnostic.

Its assertions are about the **instrument**, never the app: every load is
separately proved hydrated with a `__reactFiber$` key, and the control injects a
mismatch and requires the probe to catch it **and name the container**. Without
that, a quiet run says nothing — the vacuous green this directory exists to end.

The workflow is checked structurally, including the required-input-with-no-default
shape that once left `migrate-demo.yml` on `main` looking correct while the
Actions tab never showed it.

#### How to read a run

The job's colour says whether the instrument worked. The answer is the `LOC`
lines, and `boundary`-labelled ones are **not** evidence — that is React
completing an outlined boundary, which happens on every authenticated page.
Labelled rather than filtered out, because silently dropping a category is how
#501 reached a confident wrong answer.

#### Next

Dispatch **Mismatch locator (#510)** from `main`. If it names a container, #510
has its first location in weeks of investigation. If it comes back clean with
the control firing, that is also information: the defect would be narrower than
these four routes.
