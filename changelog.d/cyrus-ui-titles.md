### Browser tabs name the page, and the nav, heading and tab agree (Cyrus)
`cyrus/ui-titles`

Contractors said the app was too hard to use. One cheap reason: a page had
three names. "Union & fringe" opened "Union fringe & apprenticeship", and 66
of 67 tabs read just "C Stream", so tabs, history and bookmarks could not be
told apart.

The root layout now sets a title template (`%s · C Stream`) and every page in
Cyrus's lane, plus the public and settings pages, exports its own title. Three
names were brought into line: "Fringe & apprentices" (nav and heading),
"Closeout & warranty" (nav now matches the heading), and "Prevailing wage"
(heading now matches the nav). "Fringe & apprentices" was picked over "Union
fringe & apprentices" because the longer label measured 191px in Chromium
against about 176px of rail, so it would have been cut off. Pages that already
named the product in their title (landing, pilot, Ask) use `absolute` so they
do not end in "C Stream · C Stream".

Diego's pages (jobs, estimating, bids, pipeline, billing, WIP) are unchanged
and still show "C Stream". The proposed names for them are in a separate issue.

The check is `components/pageTitleCensus.test.ts`: for every nav item whose
page exports a title, the title must equal the nav label and must be one of
the page's `<h1>` texts. It has a floor of 25 checked pages, so a parse that
stops finding titles fails instead of passing. Mutation-tested: renaming the
Safety label failed it, and the "Usage — who is still logging in" heading was
caught on the first run.
