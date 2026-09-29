### Two link fields went into an `href` unchecked, and `type="url"` was doing the guarding (Cyrus)
`cyrus/seed-counters-zzbqtu`

This started as a tidy-up — five action modules each carried their own
`optionalLink` — and turned into a security fix on the way.

**`ApprenticeshipCommittee.sourceUrl` and `PrevailingWageDetermination.sourceUrl`
had no server-side URL check at all.** `dasForms.ts` read the first with
`text(formData, "sourceUrl")` and `labor.ts` read the second with
`String(formData.get("sourceUrl") ?? "").trim()`, and both are rendered
straight into an `href` — `ApprenticeshipCommitteePanel.tsx:111` and the job
compliance tab. Both inputs carry `type="url"`.

**That attribute is a browser hint and no part of the server's story.** A
Server Action receives whatever the POST body contains. So a member could
store `javascript:…` on a committee record and it became a script running in
a colleague's session the moment they clicked "Where this came from" — stored
XSS inside the tenant, needing nothing but an account that can edit
compliance records.

`lib/ask/webSuggestions.ts` already had the rule written down, in as many
words: *"Absolute http(s) links only. A stored source is rendered as a link on
the job page, and a `javascript:` URL there would be a script."* These two
fields were simply the places nobody applied it.

**Why the duplication is what let it happen.** Five modules had their own
`optionalLink`. Three were byte-identical; `prevailingWage`'s was BETTER — it
named the field in the refusal — and the worse version won three-to-one. That
is CLAUDE.md's #526 shape: one canonical thing, several hand-written copies,
and no way for a completeness test to notice a module that never adopted it.
With five copies there was no single place where "does every link field go
through this?" could even be asked.

**One implementation now, in `lib/actions/shared.ts`, and a deliberate pair.**
`optionalLinkFromForm` returns `{ ok, value } | { ok, error }`;
`optionalLinkOrThrow` throws `InputError`. **That split is not decoration.**
Every deleted copy threw, which is correct only inside `runAction` — and
`uploadPrevailingWageDetermination` is NOT wrapped in `runAction`, it returns
`actionFail` directly. A throw there would have reached a real user as the
digest production redacts a thrown Server Action message into, which is this
repo's oldest scar. Same reasoning and same shape as the `ownerRefusal` /
`assertOwner` pair `shared.ts` already documents.

**One small honesty fix rode along.** Every old copy accepted `http:` while
telling the person it needed `https://`. The behaviour is unchanged —
breaking a GC portal that is still plain HTTP would be the worse trade — and
only the wording is accurate now.

**The guard is the "is there a second one" kind, because the other kind could
not have caught this.** `linkValidationCensus.test.ts` asserts that no module
carries its own URL-scheme check, and that every function reading a
url-shaped form key calls one of three validators: `optionalLinkFromForm` /
`optionalLinkOrThrow` for a link a PERSON TYPED, where the scheme is the
risk; `documentUrlProblem` or `isBlobStorageUrl` for a blob URL the upload SDK
returned, where the risk is that it is not our store. None subsumes another.

**The third validator was found by the census contradicting me on its first
run.** `recordIntakeDocument` and `recordJobMedia` came back as offenders, and
reading them showed `isBlobStorageUrl` plus per-tenant path checks — a
validator this file had not been told about rather than a hole. An exemption
discovered by being contradicted is worth more than one assumed in advance.

Scope is the actions directory asserted to exist; size is cross-checked by a
second expression; comments are stripped before every structural read — which
matters concretely, because `shared.ts`'s own header quotes
`String(formData.get(...))` while explaining the bug and both patched
functions name `javascript:` in their comments. A raw-text census would have
found unvalidated reads that do not exist.

Mutation-tested four ways, each red and naming the offender: the committee
field reverted to an unchecked read, a module growing its own protocol check
back, the shared validator made to accept `javascript:`, and the walk pointed
at a directory that does not exist. Control green before and after every one —
the harness restores from file copies rather than `git checkout --`, which on
an earlier run silently reverted the change under test and made two results
meaningless.

**And a second existing census caught the change**, which is the part worth
keeping: `actionErrorBoundaryCensus.test.ts` pins the shared parsers that
raise `InputError` at a literal roll-call, and its own comment says *"adding a
raising parser to shared.ts is a deliberate act, and updating this line is
part of it."* It went red on `optionalLinkOrThrow` immediately. Registered,
with the reason beside it.
