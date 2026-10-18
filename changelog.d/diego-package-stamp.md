### Two bid packages, two file names — found by clicking production

The package file name was the project and the DATE. A click-through of #785 on
the live app built a package, added a file, built it again, and both landed in
Downloads as `West-Herr-Jaguar-2026-10-14-bid-package.pdf` — the second one
quietly renamed `(1)` by the browser.

**The quiet part is the danger.** The next step after a rebuild is uploading to
a GC portal, and the two candidates differ by a character nobody reads. The
failure is: spot a wrong attachment, fix it, rebuild, upload the first one.

The stamp is now the moment, to the second: `West-Herr-Jaguar-2026-10-14-143207-bid-package.pdf`.

### Minutes would not have fixed it, and neither would a prop

**Seconds, not minutes.** The rebuild in that story happens about twenty seconds
after the mistake is spotted, which is inside the same minute.

**Read at the press, not at the render.** The first version passed the date down
from the server as a prop, which was correct about hydration and useless here:
every package built from one page load would still share a stamp, which is
exactly the case this exists to stop. `packageStamp(new Date())` is called in the
click handler — safe for the reason `localToday.ts` gives, since an event handler
is not render and has no server markup to disagree with. The page no longer
passes a date at all, and `viewerToday()` is gone from it.

**Local time, not UTC.** This is the only string in the product that is a label
for somebody's own filing rather than a stored instant; "the package I built
after lunch" has to sort where they expect. The standing UTC rule is about data,
and nothing here is stored.

### Verified

Preflight's four gates green, no production schema touched.

**Seven mutations, all red**: the stamp back to a date alone, the stamp losing
its seconds, padding dropped, the month off by one, the file name losing the
stamp, the page passing a server-rendered date again, and the stamp computed
once at mount instead of at the press.

**That last one needed a new assertion, and the first attempt at it was a bad
mutation.** Replacing the call with an undefined symbol "passed" only because
vitest does not type-check — a mutation that cannot compile proves nothing. The
honest version hoists the stamp into `useState(() => packageStamp(new Date()))`:
it compiles, renders identically, and restores the defect exactly. Every test
stayed green under it, because happy-dom cannot run the build at all — no
`File`, no `URL.createObjectURL`.

So the guard is a SOURCE assertion, which is usually the weak kind and is the
right kind here: the defect is *where the call sits*, which is the one thing
reading the source can actually see. It pins the call at the point of use and
requires there to be exactly one.

### And the hours census caught it on the way past

`pad(at.getHours())` reads like a rendered hours figure, and
`hoursRenderCensus.test.ts` failed the build over it — correctly. `getHours` is
exactly the name worth stopping; this is the rare caller that means a time of
day rather than a quantity of work. It is in `NOT_AN_HOURS_NUMBER` with the
reason, including why `formatHours` would be actively wrong here: it renders
`14.00`, which would drop the minutes and seconds and reintroduce the very
collision this change is about.
