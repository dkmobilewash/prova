### A sub emails a PDF quote and the fields fill themselves in — nothing saved until a person presses the button (Diego)
`diego/quote-extract`

An estimator levelling three subs was retyping each quote by hand out of a
PDF: package, who quoted, the amount, the date, and the exclusions that
decide whether the cheapest is actually the cheapest. `/bids` now takes the
file and proposes all five. The form it fills is the one that was already
there — `saveBidQuote` is untouched, and pressing **Add quote** is still the
only thing that writes a row.

**The plan called for two new models and they are not here, deliberately.**
The step-1 brief specified `QuoteDocument`/`QuoteLine` as "feature 5's
normalised quote schema". That schema already existed: `BidQuote` from #494,
whose levelling module already compares within a package, excludes unanswered
requests so a null cannot sort to the front as cheapest, and diffs the
exclusions to say whether two prices are comparable at all. Building a second
one beside it would have been the thing the brief opens by forbidding. So the
comparison half was already built and only the reading was missing, which
makes this a much smaller change than its name suggests.

**Never invent a number is the first rule of the prompt and the only thing
worth paying to measure.** A quote with a range, a unit price with no
quantity, or a base bid plus separately priced alternates has no single total
until an estimator decides which alternates are in — so `amount` comes back
null with the reason beside it, rather than a confident figure on the field a
bid is built from. Null is not a degraded answer: it is the state an
unanswered request is already in and the levelling module understands it.
`quoteRead.eval.ts` scores this **asymmetrically** on seven synthetic
documents, and that asymmetry is the whole design — an invented or wrong
amount fails the eval, a missed one is reported and allowed, because a missed
total degrades to what the estimator did before this feature existed. Scored
together, a model could trade three inventions for three extra reads and call
it progress.

**The fixtures are generated, never committed, and proved real for free.**
Customer quotes are a competitor's pricing and must never be a fixture, so
every case is invented and written as a real PDF at run time — there is no
binary in the tree to leak. The risk in hand-writing a PDF is the
cross-reference byte offsets, which rot silently the moment somebody adds a
line to the writer and would surface as *the model* misreading the document.
`quoteFixtures.test.ts` reads all seven back with the `pdfjs-dist` this app
already ships and fails if the text does not come out; it runs in CI, in a
second, for nothing. So the eval is never measuring a model against a file
nobody checked.

**A click-through on a preview found the bug that mattered, and every test in
the repo was green while it shipped.** Reading a quote charges a page of the
company's monthly allowance, and the screen said nothing. The sentence was
computed by the action, returned on the suggestion, and set into
`QuoteReader`'s own state one line before `onRead` — which bumps `formKey` in
`QuoteForm`, and that key sits on the `ActionForm` **containing**
`QuoteReader`. React unmounted the subtree and mounted a fresh copy with the
state back at `null`. The message was destroyed by the same call that filled
the fields in. A person was charged and told nothing.

**What made it invisible is an asymmetry worth remembering.** A failed read
never calls `onRead`, so no remount happens, so every error and every refusal
rendered perfectly — the switch-off refusal, the upload failure, all of it.
Only the success message was unreachable, and only on a real mount, which is
why it survived typecheck, 8,146 unit tests and a full build. The allowance
sentence is now held by the parent and passed down as a prop, which cannot be
lost that way, and it is suppressed while a read is in flight or after one
failed, because a charge line standing beside a fresh error reads as that
error having cost money.

**The regression test mounts `QuoteForm`, not `QuoteReader`, and that is the
point of it.** The defect was in neither component: `QuoteReader` set and
rendered its own state correctly, `QuoteForm` remounted correctly. It lived in
the composition — a `key` in one file, state in another — so a unit test of
either half passes while the feature is broken. Mutation-proven by restoring
the original local state: two of three cases go red, and the one that stays
green is the refusal, exactly the path whose missing remount hid this for a
week.

**A census had been scanning test files since it was written.** Mocking the
actions barrel put the name `deleteBidQuote` in a `.test.tsx`, and
`rowActionsCensus` reported it as a component deleting rows with no confirm
step. Its action-module walk had always excluded tests; its `.tsx` walk never
did, and nothing had noticed because until now the repo held exactly one
`.tsx` test and it names no removal action. Excluded rather than added to
`CALLBACK_EXCEPTIONS`, which would have parked a false statement — "a test
file is a component that legitimately does not confirm" — where the next
reader would trust it. 360 files of 362 are still scanned; the two dropped are
both tests.

**What it reuses rather than adds.** The same page allowance the Ask box and
the compliance upload claim from, because a second ledger for a second kind of
document is how a bill stops adding up. `aiGate` for the per-company switch,
so a contractor can allow us to read their own lien waivers and refuse us a
competitor's pricing — which is why `QUOTE_EXTRACT` is its own enum member
rather than reusing `COMPLIANCE_EXTRACT`, and the only reason this change
carries a migration at all. A failed call MARKS rather than releases its
claim, the rule every metered caller here follows. And `reportUsage` is
exported rather than copied, because two copies of "report before checking the
result, because a call that produced nothing usable still cost the money" is
how one of them stops being true.

**The refusal costs nothing, and that is measured rather than assumed.**
Logging a quote by hand has always worked and still does, so switching this
feature off leaves a short sentence and a form that behaves as it always did.
Confirmed on the preview: a refused upload left the allowance unmoved.

Migration `20260927180000_add_quote_extract_feature` adds one enum value and
does nothing else, because `ALTER TYPE … ADD VALUE` may run inside a
transaction on PG 12+ but the new value cannot be USED in that same
transaction, and Prisma wraps every migration in one.
