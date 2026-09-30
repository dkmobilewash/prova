### The free classifier can finally read the page, and CO #1's $7,595 got its line item back (Cyrus)
`cyrus/seed-counters-zzbqtu`

Two things, and the first one is a capability that was built, documented and
never called.

**`lib/intake/classify.ts` has a complete text-evidence path that nothing
ever fed.** It matches "Certificate of Liability Insurance", "Request for
Taxpayer Identification Number", "IN WITNESS WHEREOF", "Application and
Certificate for Payment" and a `Project:` job hint, and it quotes the
fragment it matched as the reason it shows a person. It reads all of that
from `textPreview`. There were four references to that field in the entire
repository: the action reading it off a FormData, the email path passing
`null`, and two lines inside the classifier consuming it. **No producer
anywhere.** Every detector that needed text was unreachable on every live
path, and `scan_0042.pdf` stayed UNKNOWN forever.

`classify.test.ts` was green throughout — 584 lines of it — because it calls
`classifyDocument({ textPreview })` directly. It proves the detectors work
and says nothing about anybody feeding them. That is this repo's "written,
documented, and never called" shape wearing a form field.

**Why it is worth fixing rather than deleting: the classifier is free.** Pure
regex, no model call, no query. It is the triage layer that decides which
documents deserve a paid read, and a whole-document read is costed in-repo at
$2.25–$4.50 against a 300-page monthly allowance. Every point of accuracy
here is a paid read not spent.

`lib/intake/pdf-text.ts` reads the first page in the browser — the second use
of the already-installed `pdfjs-dist` and the same dynamic import
`TakeoffPlanViewer` uses, so no new package and a shared chunk. It runs
concurrently with the upload rather than before it, is capped at 4,000
characters and 4 seconds, and **never throws**: a scan with no text layer, an
image, or a PDF that will not open all return null, which is the
filename-only classification every file got until now. The inbound EMAIL path
is deliberately untouched and still passes `null`, because extracting text
from an arbitrary emailed file is "parser attack surface a webhook has no
business opening" — a dropped file is one a signed-in person chose and opened
in their own tab, which is a different exposure.

**The check that proves it** is `lib/intake/textPreviewCensus.test.ts`, and it
guards the whole CHAIN rather than any one function, because the defect was a
broken chain: every caller of `recordIntakeDocument` sets `textPreview`, the
action still reads that key and still passes it to `classifyDocument`, and
the classifier still declares and reads the field. Any one of those three can
be deleted without breaking a type, and each alone silently restores the
original defect. Scope comes from Tailwind's `content` globs, call sites are
counted a second time by a different expression (importers vs. callers), and
every structural read is on source with comments stripped — load-bearing
here, since `IntakeDropZone.tsx` names `recordIntakeDocument` in three
comments and calls it once, so a raw-text census would find four call sites
in one file.

Mutation-tested six ways, each killing the right assertion by name: either
producer dropped, the set surviving only as a comment, the action's read
removed, the classifier's read removed, and a `content` glob pointed at a
directory that does not exist — which trips the scope check and the size
check both. The first run of that harness restored files with
`git checkout --`, which reverts to the INDEX and therefore wiped the
unstaged change under test; two of its six results were about an
already-reverted file and proved nothing. The harness now restores from file
copies and asserts a green control after every restore, which is the only
reason that was caught.

**And the second thing, rescued rather than written.** #546 squash-merged,
which rewrites a branch's commits under new SHAs — so `git log
origin/main..HEAD` still printed all five and read as "nothing landed".
Checked by content instead: main has `LIST_COMPANIES` and the company-scoped
`providerMessageId`, and did NOT have `DEMO_JOB_NAMES`, `announceUntagged`,
`restore-names` or `originChangeOrderId`. Three commits were genuinely
stranded and one of them is a money fix: **CO #1 was seeded APPROVED with no
`JobLineItem`, leaving $7,595 of scope in no line item at all** on the job
the launch video films. `approveChangeOrder`'s ADD branch creates that row;
the seed wrote the terminal state directly and skipped it. Reseeding the demo
database from `main` would have put that back on camera.

The general lesson, which this repo has paid for before in the other
direction: a fixture that reaches a terminal state by WRITING the state
rather than running the transition is wrong in exactly the ways the
transition's other side effects are invisible.
