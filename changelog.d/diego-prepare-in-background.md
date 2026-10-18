### The sheet job stops the moment you look at another tab (Diego)
`diego/prepare-in-background`

No migration. One render option and a guard.

**FOUND BY RUNNING IT ON A REAL SET AND WATCHING IT STOP.** Preparing the
113-sheet drawing froze on sheet 17 and stayed there. Nothing was broken: the
button still read *"Preparing sheet 17 of 113…"*, disabled and spinning, and
the page reported no error. It simply was not going to finish, ever.

Measured in the live page rather than guessed:

| probe | |
| --- | --- |
| `document.visibilityState` | `"hidden"` |
| a probe `requestAnimationFrame` | **did not fire within 4 seconds** |
| last network request | **248 seconds earlier** |
| JS heap | 77MB of 4192MB — not memory |

pdf.js schedules each chunk of a render with `requestAnimationFrame`, and
**Chrome never fires one in a hidden tab.** Read out of the installed
pdfjs-dist 4.10.38 rather than recalled:

```
useRequestAnimationFrame: !intentPrint                  pdf.mjs:16971

_scheduleNext() {
  this._useRequestAnimationFrame
    ? window.requestAnimationFrame(...)    // frozen while hidden
    : Promise.resolve().then(this._nextBound)   // a microtask, always runs
}
```

So `intent: "print"` is the switch, and it has nothing to do with printing.
It also happens to be the right APPEARANCE here — the PNG is a stand-in for the
paper sheet, so printed annotations are what a foreman should be looking at.

**Why this was unusable rather than merely slow.** The job takes about half an
hour on a real set. Nobody is going to sit and watch a tab for half an hour, so
without this the feature does not complete for anybody — while looking the
entire time like it is working. That last part is what makes it this repo's
favourite shape of bug.

| mutation | result |
| --- | --- |
| control | green |
| **the print intent removed** | **RED** |
| intent changed to `"display"` | **RED** |
| the explanation stripped | **RED** |

The second one came back GREEN first time, and the mutation had not reached the
code: the file says `intent: "print"` in its own comment, the census strips
comments, so the replacement hit prose. Re-run against the actual call — with
the comment-stripped text compared before and after to prove the CODE moved —
it is red. *A mutation must be verified to have changed the thing under test,
not merely the file.* Second time in two days that rule has earned itself here.

The guard also requires the explanation to stay. `intent: "print"` on something
nobody prints reads like a copy-paste error; without the reason beside it, the
next person removes it and the job silently stops finishing again.

**Nothing else here could see any of this.** No test in this repo renders a PDF
or has a tab to hide, and typecheck, lint, 8,940 tests and a full production
build were green with the frozen version.

578 files / 8960 tests, typecheck, lint, a full production build and preflight
clean.
