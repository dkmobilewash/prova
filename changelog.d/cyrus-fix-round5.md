### A pasted #anchor link lands on its section, and forms opened by ?new=1 no longer put a date in server markup (Cyrus)
`cyrus/fix-round5`

**Fresh-load anchors.** `/cash-flow#retainage` worked by click-through and
opened at the top on a reload or pasted link. On a full load React streams
the page into `<div hidden id="S:…">` and reveals it later; the id already
existed inside that hidden div, `HashLanding` scrolled the invisible copy
(a no-op), counted it as landed and stopped watching. It now only lands a
section that is out of `[hidden]`, and keeps watching until it is.
Check: `hashLanding.test.tsx` "on a fresh load…" — red with the old check.

**startOpen dates.** BackchargeForm, MaterialOrderForm, FieldReportComposer
and CrewScheduleBoard called `localToday()` during render, which is only
safe in a form a click mounted; `?new=1` / `?add=1` (startOpen) puts them in
server-rendered markup, so on any evening west of UTC the server's date and
the browser's disagreed. New `useLocalToday()` (in `localToday.ts`) is ""
until after mount. Check: `startOpenDateCensus.test.ts` fails the build if
any form with `useState(…startOpen…)` calls `localToday()`;
`localToday.test.tsx` proves the hook's server markup carries no date.

**"First click does nothing" — no app cause found, nothing changed.** No
global click/pointer handler swallows events (NavigationProgress only
listens; the leave guard attaches only when a form is dirty; outside-click
closers attach only while open), no overlay or `pointer-events:none` sits
over the page at rest, and Reveal never parks content invisible. Reported on
the dev server on old and new UI alike, which fits dev-mode hydration: clicks
on React buttons before the (unminified, compiled-on-demand) client bundle
hydrates are dropped. Re-test on a production build before treating it as a
bug.
