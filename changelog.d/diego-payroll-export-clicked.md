### The payroll export, fetched rather than argued about (Diego)
`diego/payroll-export-clicked`

No migration, no product change. One e2e spec.

**#596 shipped the hours-OUT half of payroll with 198 lines of unit tests on
the row builder and nobody having asked the route for a file.** The pure half
was well covered. What was not covered is everything that only exists once it
is an HTTP response: the capability gate, the content type, the filename, and
the header row a payroll clerk opens in Excel.

**THE ASSERTION WORTH THE FILE IS THE REFUSAL ONE**, and the trap it guards
is already written down in this repo: a route that refuses by REDIRECTING
sends the sign-in page with a 200, and the browser saves that HTML as
`payroll-….csv`. The clerk opens a spreadsheet full of markup with no way to
tell that from an export bug. The refusal must be plain text with a 403.

| mutation | result |
| --- | --- |
| control | green |
| the route refuses by redirecting to sign-in | **RED** |
| the per-diem column is dropped from the export | **RED** |

Both checked for VACUITY as well as colour — the harness requires
"Running 2 tests" in the output, so a build break cannot pass itself off as a
caught regression. Files restored byte-for-byte, never by `git checkout`.

**TWO OF THE THREE FAILURES ON THE WAY HERE WERE THE SPEC BEING WRONG ABOUT
THE PRODUCT, and both are worth writing down.**

The first selector looked for a link matching `/export/i`. The link reads
**"Download hours for payroll (CSV)"** — it says what it DOES, not what the
route is called, which is the better label and the reason the spec missed it.

The second is the transferable one: the refusal test signed in as MAIN,
called `page.context().clearCookies()`, and signed in as FIELD. Clerk threw
**"You're already signed in"**. **Clearing cookies looks like signing out and
is not.** Each `test()` already gets a fresh context, so the fix was to sign
in only as FIELD — which is also the more realistic shape of the attack, since
a field user cannot load the certified-payroll page to read the link in the
first place. They would have a guessed or shared URL, and that is now what the
test sends.

**What this does NOT prove, stated because the gap is the point.** The e2e
seed creates no time entries, crew or craft classifications, so this covers
the route and the SHAPE of the file — not that the numbers are right for a
real week of hours. That needs a job with real payroll data, and the only
place one exists is production.

559 files / 8692 tests, typecheck and lint clean.
