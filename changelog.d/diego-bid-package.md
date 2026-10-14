### The bid package assembles itself, on the estimator's own machine

Of the 34 sub-tasks in the estimating workflow, three were not in the code at
all. This is the first of them: *"Package proposal, detailed scope sheet,
manufacturer cut sheets, and required GC bid forms into a unified PDF."*

What an estimator did instead: print the proposal, download the GC's form, find
the cut sheets, open Acrobat or Preview, combine, reorder, save, name it. A
press count of all nine steps on one real bid reached step 9 and stopped —
nothing assembled a package and nothing submitted one.

Now: the proposal page has a **Build the bid package** section. Attach the
parts, press once, get one PDF in the order a GC opens it — their form first,
then the proposal, then the numbers behind it, then the evidence.

### It merges in the browser, and that is the design

Three reasons, in the order they decided it:

- **The documents never leave the machine.** A bid package is the most
  confidential material this product touches. A merge needs no model and no
  server, so the bytes have no business on one.
- **There is no body limit to lose to.** A Server Action body is capped at
  exactly 1 MB by the framework — `document-uploads.ts` records five actions
  that shipped with guards which could never fire — and a serverless request
  body is capped well under one real cut sheet. Uploading each part to blob
  storage first would dodge both and would mean **storing**, with a reaper
  nobody has written.
- **Nothing to clean up.** No row, no blob, no scratch file.

`pdf-lib` is therefore imported *dynamically* inside `buildPackage`: the
planning half is dependency-free, and a page showing the control does not ship a
PDF library to anybody who never presses it.

### A new dependency, and the argument it had to answer

`pdf-lib@1.17.1`, MIT, in `apps/web`. **Its last release was 2022** — stale,
recorded here rather than discovered later.

`plan-ingest/planFixtures.ts` deliberately avoided this dependency and said why:
*"`pdf-lib` would be one npm install, but a production dependency added for a
test needs its licence checked… and a minimal PDF is a documented format."* That
reasoning is right and does not reach this file. Writing a page from nothing is a
documented format; **merging** somebody else's PDF means renumbering every
indirect object, rewriting the cross-reference table and reconciling resource
dictionaries — for a file a GC produced with software nobody here chose.
Hand-rolling that is how a bid goes out with a blank page in it.

That same fixture writer is what the tests merge, so there is **no binary in the
tree and no customer file in a fixture** — the standing rule, with more force
here than anywhere.

### What it deliberately does not do

**It does not generate the proposal.** The proposal page is print-styled HTML
plus the browser's own Save as PDF; a second renderer of the document that
decides who pays when scope is disputed would be two sources of one legal text.
The proposal comes in as a file, printed with the button above it.

**It does not yet pull in the addenda and certificates already uploaded.** That
is the next slice and it is where this stops being a merge tool — but it needs a
validated read back out of the blob store per document, and shipping the merge
first means that slice lands on an engine already proven against real files. The
screen says so rather than implying otherwise.

**It stores nothing**, so there is no attachment storage for a GC's form —
`BidRequirement` has no `fileUrl`. Adding one is a schema decision and goes in
Slack before it goes in a migration.

### Verified

Preflight's four gates green, 704 test files, 10,937 tests, no production schema
touched.

**Sixteen mutations, all red**: the GC's form losing its place at the front, a
part with no file silently dropped, a non-PDF admitted, the magic-number check
accepting anything, the size ceiling never firing, every package downloading
under one name, the page never mounting the builder, the builder printing into
the GC's own document, Build pressable with nothing chosen, a slot missing from
the screen, the local-merge promise removed from the screen, a part that fails to
open reported as missing, a part that fails to copy dropped in silence, and the
encryption check reverted to either of its two dead versions.

### Three defects the measurements caught, two of them mine

**An empty package was a blank one-page PDF.** `PDFDocument.create()` reports 0
pages and `save()` on it emits a 583-byte **one-page** document — measured, and
the opposite of the obvious behaviour. So an all-skipped package produced a blank
file named `…-bid-package.pdf` that an estimator could have sent to a GC.
`buildPackage` now returns `bytes: null`, and the type makes the caller tell the
difference.

**The encrypted-PDF branch was dead code, twice.** It shipped as
`error.name === "EncryptedPDFError"`, which can never be true, and was then
"fixed" to `instanceof EncryptedPDFError`, which is also false. One cause: pdf-lib
ships ES5 and builds its errors through tslib's `__extends`, whose body is
`_this = _super.call(this, msg) || this; return _this` — and `Error.call(this, msg)`
returns a *fresh* error instead of mutating `this`, so the constructor hands back
a plain `Error`. The subclass does not exist at run time: no `name`, nothing for
`instanceof`. The message is the only identifier, and the library's own literal is
pinned in the test so a reword fails loudly. The cost of the bug was a sentence —
a locked cut sheet reported as "could not be read", sending somebody to hunt a
corrupt file instead of asking the manufacturer for an unlocked copy.

**And the test for that fix did not test the fix.** It asserted the library's
error properties, so reverting the classifier to *either* dead version left it
green. That is this repo's own rule arriving as a mistake — a census proves a
string exists, never that anything computes it — and the classifier is exported
and called directly now.

One bound stated rather than papered over: no test feeds `buildPackage` a
genuinely encrypted PDF, because nothing here can write one. A hand-written
`/Encrypt` trailer was tried and pdf-lib rejects it as malformed *before* the
encryption check, so that fixture would prove the unreadable branch while looking
like it proved this one.
