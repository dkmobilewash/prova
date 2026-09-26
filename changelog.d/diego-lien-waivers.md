### Lien waivers: what you signed away, and what you kept (Diego)
`diego/lien-waivers`

The waiver a sub hands the GC to get paid — the paperwork that decides
whether a payment is released. Today `ComplianceDocumentType.LIEN_WAIVER`
covers only the inbound direction, and the outbound one is modelled
nowhere.

**It closes ONE Partial row, not the three the heads-up claimed.** The
plan said this would also close the two e-signature rows. It does not, and
the reason is the redesign below: waivers are signed on the GC's form, so
there is no Prova e-sign page for one and those rows are untouched. Said
here because the overclaim was mine and would otherwise have reached
FEATURE-AUDIT.

**The direction is the whole reason this is a new model.**
`ComplianceDocumentType.LIEN_WAIVER` already existed and is the INBOUND
one: waivers the sub COLLECTS from its own subs and vendors, keyed on a
required `partyName`, PENDING → RECEIVED, with AI-extracted fields that
stay editable on purpose. This is the OUTBOUND one, and the decisive
reason they cannot share a table is not that they feel different — **they
have opposite mutability rules.** That model documents its fields as "a
'please verify' signal for the UI, not a lock"; a signed waiver is an
evidence record whose identity locks at signing and which is voided,
never deleted. One table cannot hold both. The ordinary reasons pile up
behind that: PENDING/RECEIVED are the wrong states for something you
sign, `partyName` would duplicate the job's GC, `jobId` is optional there
and required here, and the signing apparatus plus the exception columns
would be null for every COI in the table. They should still be findable
together — that is a read concern, not a schema one.

**Two enums, not one four-valued one.** `LienWaiverCondition` ×
`LienWaiverStage`. Every pairing is a real statutory form, so there is no
impossible state to rule out — the opposite of `BidLine`'s alternate
amount, which is one signed column precisely because an amount plus a
direction flag can contradict itself.

## The part that is the feature

Picking the wrong form is the obvious failure and the rare one. The
expensive one is **an unconditional waiver with the exceptions left
blank**, which gives up retainage and every pending change order along
with the payment actually being made — a document that reads as routine
paperwork and costs the held percentage of the job.

So `exceptedAmount` is **required and defaultless**. A caller cannot omit
it and land on zero, which is exactly how zero would get there; the action
refuses an empty field rather than reading `Number("")` as 0. Zero is a
common and legitimate answer — the point is that it has to be one somebody
gave.

Retainage held and SUBMITTED change orders are offered as **candidates
beside the field**, from rows the app already has. `lib/lien-waiver.ts`
never writes them in. The one concession is a button that fills the field
with the total: a person who reads "$8,000" and retypes it is doing data
entry, and the typo lands in the worst possible field. **A tap is a
decision; a default is not.**

Three warnings, live as the form changes rather than on submit:

- a FINAL waiver while retainage is outstanding — **and it fires even when
  the exceptions cover it**, because the excepted figure is a number typed
  today and the balance moves while the waiver does not;
- an UNCONDITIONAL waiver with no payment recorded against its invoice,
  which offers the conditional form rather than just scolding. Silent when
  no invoice is attached: `null` is "nothing to check", not reassurance;
- exceptions that fall short, naming each source and its amount, because
  "your exceptions are too low" is not something anybody can act on.

**None of them blocks.** Subs sign unconditional waivers against money
that has not landed, because the GC will not release the cheque
otherwise. Refusing the save would make the app wrong about the world and
teach people to route around it.

**And nothing here ever says a waiver is safe to sign.** That rule is
lifted wholesale from `liens.prisma`, which forbids computing a legal
deadline for the same reason: a confident wrong answer costs lien rights
in the same voice as a right one. No state-rules table, no generated
statutory wording. A test pins it — no message may contain "safe to sign",
"looks good", "no issues" or "all clear" — because **an empty warning list
is not an opinion**, and a waiver can be catastrophic for reasons this app
cannot see.

## What the guards caught, which is most of the value of the day

Four censuses failed on this work and every one of them was right:

| guard | what it refused |
| --- | --- |
| `rowActionsCensus` | a `ConfirmDelete` in `RowActions`' children — it unmounts itself when armed, so the row's actions vanish and a reload is the only way out |
| `reachable` | three actions with no UI behind them |
| `retainage-single-source` | a second file reading the retainage column without saying why |
| `action-capability-guards` | a module whose actions no case would ever execute |

The `ConfirmDelete` one is a bug I would have shipped, and fixing it
properly is what produced the inline edit — `RowActions` needs an ordinary
action to hide, which is also what made `updateLienWaiver` reachable.

:mag: **And `reachable` itself was disarmed by this PR's own Ask
exclusions.** Registering `{ action: "createLienWaiver", reason: … }` in
`lib/ask/commands/exclusions.ts` made all three actions read as reachable,
because the check is a `\bname\b` regex over file text and that file's
entire purpose is to NAME ACTIONS IT DOES NOT CALL. Writing "this is
never a command" marked them as called.

Measured before fixing rather than asserted: 16 actions carry an
exact-name exclusion, and the other 13 all have real call sites in `app/`
or `components/` — so the hole was open and had not yet been fallen into.
That file is now excluded from the scanned set. Proved by mutation in both
directions: removing the three names turned it red before the fix, and
after the fix only the three genuinely UI-less actions were red, with
nothing pre-existing falling out.

This is the third time that file has been blind — its own header already
counts two, and the new note makes it three. Same family as CLAUDE.md's
#185: a census disarmed by text quoting its own pattern.

## Deliberately absent

**No counter.** Waivers are not statutorily numbered; there is nothing to
issue and nothing to reissue. Said out loud because the counter roll-call
is long and somebody will reasonably ask.

**No delete.** A waiver is withdrawn, which keeps the row and the fact
that it was issued — the same rule that is why there is no
`deleteInvoice`. A waiver that went out and was pulled back is a fact
somebody may have to account for, and a delete loses exactly that.

**No `documentUrl`/`documentName` yet.** The executed statutory form is
worth keeping and this model will carry it, but there is no shared
uploader in this app — `ComplianceUploadForm`,
`ContractDocumentUploadForm` and `TakeoffPlanUploader` are three separate
implementations — so it is its own piece of work. Shipping the columns now
would make them the "written, documented, and never called" shape; adding
them later is a three-line additive migration.

**No e-sign page, and the columns for one are gone.** The first cut of
this model copied `token`, `snapshot`, `expiresAt`, `ipAddress` and
`userAgent` from `SignatureRequest`. Then the build ran and the question
was obvious: nothing writes any of them, because there is no page to sign
on — `SIGNED` was unreachable. Five dead columns is the same defect as the
two I had just refused for `documentUrl`, one level worse for being the
feature's own status field.

The fix is the domain rather than a smaller version of it. A lien waiver
is signed on the GC's statutory form, in the GC's system or on paper —
the app already refuses to generate that wording, and it follows that the
app is not where the signature happens. So `signedAt` is **entered**, read
off the executed document, the same rule as `markLienDeadlineServed` and
the same rule CLAUDE.md states for every date that matters. What this
model is is the RECORD: which form went out, what it excepted, whether it
came back. That is both smaller and more honest than a signing ceremony
nobody asked for.

**No Ask command, ever.** Excluded per action with reasons. A deadline a
model gets wrong loses a right by inaction; a waiver a model gets wrong
gives one away in writing. A confirm card carrying a proposed
`exceptedAmount` is precisely the filled-in number this design exists to
prevent — and it would arrive looking more considered than a blank field,
which is worse.

## Migration and verification

Additive: one table, two enums, four foreign keys, **zero destructive
statements**, generated by a schema-to-schema diff that opens no database
connection. Announced in `#prova-build` before the push.

`LienWaiver` is a required-`jobId` RESTRICT child of `Job`, so the #227
three edits are all present — the model, `HANDLED_MODELS`, and the `del()`
order in both cleanup scripts. Mutation: unregistering it from
`clean-scratch-data.mjs` turns `scratch-cleanup-order.test.ts` red and
names the model.

The three shared schema files gained **nine lines and no deletions**. An
earlier pass ran `prisma format` and reformatted seven files nobody had
edited, including a moved `@@unique` in `jobs.prisma`; that churn was
reverted and the lines re-applied by hand, because whitespace on a shared
schema file Cyrus is actively adding models to is how a merge conflict
gets manufactured.

7,720 unit tests, typecheck and lint clean. **Nobody has clicked it** —
that is the click-list below, and the e2e journey does not cover this
surface yet.
